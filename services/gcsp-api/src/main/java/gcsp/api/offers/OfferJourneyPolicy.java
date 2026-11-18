package gcsp.api.offers;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockResult;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyAdoption;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.ReviewedDefinitions;
import gcsp.api.scenario.ScenarioWiring;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.interceptor.Interceptor;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Startup composition adopts the explicitly configured reviewed journey successor for the run. Retained v1
 * configurations preserve their historical rule; new v2 configurations also adopt reason-specific re-entry.
 */
@ApplicationScoped
public class OfferJourneyPolicy {

    static final String SUFFIX = "+" + ReviewedDefinitions.OFFER_JOURNEY_SET;
    static final String SUCCESSOR_SUFFIX = "+" + ReviewedDefinitions.OFFER_JOURNEY_SUCCESSOR_SET;
    /** After the run clock's startup pass (LIBRARY_AFTER) and the comparison jobs (+10). */
    static final int AFTER_CLOCK = Interceptor.Priority.LIBRARY_AFTER + 20;
    static final String ACTOR = "offer-journey-startup";
    private static final Logger LOG = Logger.getLogger(OfferJourneyPolicy.class);

    @Inject
    Persistence persistence;

    @Inject
    PolicyAdoption adoption;

    @Inject
    RunClockHolder clock;

    @Inject
    PolicyService policy;

    @Inject
    ScenarioWiring scenarios;

    @ConfigProperty(name = "gcsp.environment.id")
    Optional<String> environmentId;

    @ConfigProperty(name = "gcsp.environment.run-id")
    Optional<String> runId;

    @ConfigProperty(name = "gcsp.environment.policy-version")
    Optional<String> policyVersion;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_CLOCK) StartupEvent event) {
        ensure();
        if (!"not-configured".equals(summary) && scenarios.available()) scenarios.service().onReset(this::afterReset);
    }

    /** Policy is per run, so each presenter reset re-adopts on the new run (Node's afterReset); a failure only logs. */
    void afterReset(RunContext next) {
        try {
            ensure(next.runId());
        } catch (RuntimeException e) {
            LOG.warnf("GCSP offer journey policy: not re-adopted for run %s after a reset (%s)", next.runId(), e.getMessage());
        }
    }

    /** Adopts when configured; a bad configuration or a failed adoption throws, which stops startup. */
    String ensure() {
        return ensure(runId.map(String::strip).orElse(""));
    }

    String ensure(String run) {
        String version = policyVersion.map(String::strip).orElse("");
        String set = version.endsWith(SUCCESSOR_SUFFIX) ? ReviewedDefinitions.OFFER_JOURNEY_SUCCESSOR_SET
                : version.endsWith(SUFFIX) ? ReviewedDefinitions.OFFER_JOURNEY_SET : null;
        if (set == null) {
            summary = "not-configured";
            LOG.info("GCSP offer journey policy: not configured; the reviewed decline reasons are not adopted");
            return summary;
        }
        String base = version.substring(0, version.length() - set.length() - 1);
        String env = environmentId.map(String::strip).orElse("");
        if (!persistence.active()) {
            throw stop(version, "it needs PostgreSQL (GCSP_DATABASE_URL), because adoption is stored per run");
        }
        if (base.isEmpty() || env.isEmpty() || run.isEmpty()) {
            throw stop(version, "set GCSP_ENVIRONMENT_ID and GCSP_RUN_ID, and name the base version before the suffix");
        }
        ClockReading reading = runNow(env, run);
        if (reading == null) {
            throw stop(version, "the run clock for " + run + " is not initialised, so there is no instant to adopt at");
        }
        if (baseStartsAt(run, base, reading.now())) {
            // As Node: a successor must be dated later than the base, so the run clock moves 1 ms first.
            ClockResult moved = clock.clock().advance(new RunContext(env, run, ACTOR), set + ":clock:" + run + ":" + base,
                    reading.clockVersion(), null, PolicyClock.iso(reading.now().plusMillis(1)));
            reading = moved.ok() ? runNow(env, run) : null;
            if (reading == null) throw stop(version, "the run clock could not move 1 ms past the start of " + base);
        }
        PolicyAdoption.Result result = adoption.adopt(new RunContext(env, run, ACTOR), set, version, reading.now(), base);
        if (!result.ok()) {
            throw stop(version, result.status() + ": " + result.detail()
                    + " Check that " + base + " is the active version of the run");
        }
        if (result.activation() != null && !result.activation().ok()) {
            LOG.warnf("GCSP offer journey policy: %s saved but activation is pending (%s)", version,
                    result.activation().status());
        }
        summary = result.written() ? "adopted" : "present";
        LOG.infof("GCSP offer journey policy: %s %s for run %s", version, result.written() ? "adopted" : "already present", run);
        return summary;
    }

    private ClockReading runNow(String env, String run) {
        try {
            return clock.clock().now(env, run).orElse(null);
        } catch (ClockUnavailableException e) {
            return null;
        }
    }

    /** True when base is the version in force and took effect at exactly this instant. */
    private boolean baseStartsAt(String run, String base, Instant now) {
        PolicyResult active = policy.getActiveVersion(new PolicyRead(run, PolicyClock.iso(now), null));
        if (!active.ok() || !base.equals(active.policyVersion())) return false;
        String from = active.value().path("effectiveFrom").asText("");
        return !from.isEmpty() && Instant.parse(from).equals(now.truncatedTo(ChronoUnit.MILLIS));
    }

    private static IllegalStateException stop(String version, String reason) {
        return new IllegalStateException("GCSP_POLICY_VERSION=" + version + " cannot start: " + reason + ".");
    }

    /** not-run, not-configured, adopted or present. */
    public String summary() {
        return summary;
    }
}
