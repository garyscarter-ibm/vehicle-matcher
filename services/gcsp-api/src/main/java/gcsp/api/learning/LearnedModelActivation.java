package gcsp.api.learning;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Startup composition activates the verified learned choice model for the run: adopts the reviewed FUCQ-115 set as the
 * configured +learned-model-v1 version with choice.model.reference naming the artifact. Off unless both settings are set.
 */
@ApplicationScoped
public class LearnedModelActivation {

    static final String SUFFIX = "+learned-model-v1";
    /** After the run clock's startup pass (LIBRARY_AFTER) and the comparison jobs (+10). */
    static final int AFTER_CLOCK = Interceptor.Priority.LIBRARY_AFTER + 30;
    static final String ACTOR = "learned-model-startup";
    private static final Logger LOG = Logger.getLogger(LearnedModelActivation.class);

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

    @Inject
    LearningSelection selection;

    @ConfigProperty(name = "gcsp.environment.id")
    Optional<String> environmentId;

    @ConfigProperty(name = "gcsp.environment.run-id")
    Optional<String> runId;

    @ConfigProperty(name = "gcsp.environment.policy-version")
    Optional<String> policyVersion;

    @ConfigProperty(name = "gcsp.learning.active-model")
    Optional<String> activeModel;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_CLOCK) StartupEvent event) {
        ensure();
        if (!"not-configured".equals(summary) && scenarios.available()) scenarios.service().onReset(this::afterReset);
    }

    /** Policy is per run, so each presenter reset re-adopts on the new run; a failure only logs. */
    void afterReset(RunContext next) {
        try {
            ensure(next.runId());
        } catch (RuntimeException e) {
            LOG.warnf("GCSP learned model: not re-activated for run %s after a reset (%s)", next.runId(), e.getMessage());
        }
    }

    /** Activates when configured; a bad configuration or a failed adoption throws, which stops startup. */
    String ensure() {
        return ensure(runId.map(String::strip).orElse(""));
    }

    String ensure(String run) {
        String version = policyVersion.map(String::strip).orElse("");
        String model = activeModel.map(String::strip).orElse("");
        boolean suffixed = version.endsWith(SUFFIX);
        if (model.isEmpty() && !suffixed) {
            summary = "not-configured";
            LOG.info("GCSP learned model: not configured; no model is activated");
            return summary;
        }
        if (model.isEmpty() || !suffixed) {
            throw stop(version, "GCSP_LEARNING_ACTIVE_MODEL and a GCSP_POLICY_VERSION ending " + SUFFIX
                    + " must be set together");
        }
        if (!ModelArtifact.validId(model)) {
            throw stop(version, "GCSP_LEARNING_ACTIVE_MODEL must be sha256: followed by 64 lowercase hex digits");
        }
        ModelArtifact artifact;
        try {
            artifact = selection.artifacts().read(model);
        } catch (RuntimeException e) {
            throw stop(version, "the artifact " + model + " is not readable and verified (" + e.getMessage() + ")");
        }
        String base = version.substring(0, version.length() - SUFFIX.length());
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
        String held = storedArtifact(run, version, reading.now());
        if (held != null && !model.equals(held)) {
            throw stop(version, "it already holds " + held + ", not " + model + "; use a new GCSP_POLICY_VERSION");
        }
        if (held == null && baseStartsAt(run, base, reading.now())) {
            // As Node: a successor must be dated later than the base, so the run clock moves 1 ms first.
            ClockResult moved = clock.clock().advance(new RunContext(env, run, ACTOR), "learned-model:clock:" + run + ":" + base,
                    reading.clockVersion(), null, PolicyClock.iso(reading.now().plusMillis(1)));
            reading = moved.ok() ? runNow(env, run) : null;
            if (reading == null) throw stop(version, "the run clock could not move 1 ms past the start of " + base);
        }
        PolicyAdoption.Result result = adoption.adopt(new RunContext(env, run, ACTOR), ReviewedDefinitions.CHOICE_MODEL_SET,
                version, reading.now(), base, Map.of(ActiveChoiceModel.REFERENCE_KEY, reference(model, artifact)));
        if (!result.ok()) {
            throw stop(version, result.status() + ": " + result.detail()
                    + " Check that " + base + " is the active version of the run");
        }
        if (!result.written() && !model.equals(storedArtifact(run, version, reading.now()))) {
            throw stop(version, "it already exists without " + model + " as its model reference; use a new GCSP_POLICY_VERSION");
        }
        if (result.activation() != null && !result.activation().ok()) {
            LOG.warnf("GCSP learned model: %s saved but activation is pending (%s)", version, result.activation().status());
        }
        summary = result.written() ? "adopted" : "present";
        LOG.infof("GCSP learned model: %s %s for run %s (%s)", version, result.written() ? "adopted" : "already present", run, model);
        return summary;
    }

    private static ObjectNode reference(String model, ModelArtifact artifact) {
        JsonNodeFactory json = JsonNodeFactory.instance;
        ObjectNode value = json.objectNode();
        value.put("artifactId", model);
        value.put("featureVersion", artifact.featureVersion());
        value.put("schemaVersion", 1);
        ObjectNode row = json.objectNode();
        row.set("value", value);
        row.put("status", "assumed");
        row.put("basis", "Synthetic-trained engineering artifact; thin vehicle choices, worse Brier than both baselines, "
                + "optimizer iteration-limit. No BMW calibration.");
        row.put("source", "docs/gcsp/models/fucq115-evaluation-result.md");
        row.put("sourceDate", "2026-11-06");
        return row;
    }

    private String storedArtifact(String run, String version, Instant now) {
        PolicyResult out = policy.getAssumption(ActiveChoiceModel.REFERENCE_KEY, new PolicyRead(run, PolicyClock.iso(now), version));
        if (!out.ok() || out.value() == null) return null;
        return out.value().path("value").path("artifactId").asText(null);
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
        return new IllegalStateException("GCSP_POLICY_VERSION=" + version + " with GCSP_LEARNING_ACTIVE_MODEL cannot start: "
                + reason + ".");
    }

    /** not-run, not-configured, adopted or present. */
    public String summary() {
        return summary;
    }
}
