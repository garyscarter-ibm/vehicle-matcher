package gcsp.api.offers;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyAdoption;
import gcsp.api.policy.ReviewedDefinitions;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.interceptor.Interceptor;
import java.time.Instant;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Startup composition: a configured policy version ending in +offer-journey-v1 is created for the run by adopting the
 * reviewed decline reasons and follow-up questions on top of the version named before the suffix (the Node startup rule).
 */
@ApplicationScoped
public class OfferJourneyPolicy {

    static final String SUFFIX = "+" + ReviewedDefinitions.OFFER_JOURNEY_SET;
    /** After the run clock's startup pass (LIBRARY_AFTER) and the comparison jobs (+10). */
    static final int AFTER_CLOCK = Interceptor.Priority.LIBRARY_AFTER + 20;
    private static final Logger LOG = Logger.getLogger(OfferJourneyPolicy.class);

    @Inject
    Persistence persistence;

    @Inject
    PolicyAdoption adoption;

    @Inject
    RunClockHolder clock;

    @ConfigProperty(name = "gcsp.environment.id")
    Optional<String> environmentId;

    @ConfigProperty(name = "gcsp.environment.run-id")
    Optional<String> runId;

    @ConfigProperty(name = "gcsp.environment.policy-version")
    Optional<String> policyVersion;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_CLOCK) StartupEvent event) {
        ensure();
    }

    /** Adopts when configured; a bad configuration or a failed adoption throws, which stops startup. */
    String ensure() {
        String version = policyVersion.map(String::strip).orElse("");
        if (!version.endsWith(SUFFIX)) {
            summary = "not-configured";
            LOG.info("GCSP offer journey policy: not configured; the reviewed decline reasons are not adopted");
            return summary;
        }
        String base = version.substring(0, version.length() - SUFFIX.length());
        String env = environmentId.map(String::strip).orElse("");
        String run = runId.map(String::strip).orElse("");
        if (!persistence.active()) {
            throw stop(version, "it needs PostgreSQL (GCSP_DATABASE_URL), because adoption is stored per run");
        }
        if (base.isEmpty() || env.isEmpty() || run.isEmpty()) {
            throw stop(version, "set GCSP_ENVIRONMENT_ID and GCSP_RUN_ID, and name the base version before the suffix");
        }
        Instant now = runNow(env, run);
        if (now == null) {
            throw stop(version, "the run clock for " + run + " is not initialised, so there is no instant to adopt at");
        }
        PolicyAdoption.Result result = adoption.adopt(new RunContext(env, run, "offer-journey-startup"),
                ReviewedDefinitions.OFFER_JOURNEY_SET, version, now, base);
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

    private Instant runNow(String env, String run) {
        try {
            return clock.clock().now(env, run).map(ClockReading::now).orElse(null);
        } catch (ClockUnavailableException e) {
            return null;
        }
    }

    private static IllegalStateException stop(String version, String reason) {
        return new IllegalStateException("GCSP_POLICY_VERSION=" + version + " cannot start: " + reason + ".");
    }

    /** not-run, not-configured, adopted or present. */
    public String summary() {
        return summary;
    }
}
