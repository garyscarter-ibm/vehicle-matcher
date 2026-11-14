package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.WorkResult;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Publishes a successor policy version for the principal's run: one command transaction that locks the run, reads its
 * versions, prepares the successor (PolicyPublication) and stores it, then activates the run (PolicyActivation).
 */
@ApplicationScoped
public class PolicyPublisher {

    static final String COMMAND_TYPE = "policy.publish";

    /** What a refused work callback leaves for the caller: the exact outcome to return. */
    private static final class Refusal {
        PolicyResult result;
    }

    private final PolicySource source;
    private final RetainedFilePolicySource base;
    private final PolicyDatabase database;
    private final PolicyClock clock;
    private final PolicyAuthority authority;
    private final PolicyActivation activation;

    @Inject
    public PolicyPublisher(PolicySource source, RetainedFilePolicySource base, PolicyDatabase database,
            PolicyClock clock, PolicyAuthority authority, PolicyActivation activation) {
        this.source = source;
        this.base = base;
        this.database = database;
        this.clock = clock;
        this.authority = authority;
        this.activation = activation;
    }

    public PolicyResult publish(Principal principal, JsonNode changeSet) {
        if (!database.active()) {
            return unsupported();
        }
        try {
            if (!authority.mayPublish(principal)) {
                return PolicyBodies.forbidden("role-required");
            }
            if (!database.environmentId().equals(principal.environmentId())) {
                return PolicyBodies.forbidden("environment-mismatch");
            }
            PolicyResult invalid = PolicyPublication.validateChangeSet(changeSet);
            if (invalid == null && !finite(changeSet)) {
                invalid = PolicyBodies.invalid("changeSet", "Supply finite JSON values without cycles or unsupported types.");
            }
            if (invalid != null) {
                return invalid;
            }
            RunContext context = new RunContext(principal.environmentId(), principal.runId(), principal.subject());
            String now = PolicyClock.iso(clock.now(context));
            PolicyResult outcome = execute(context, principal.subject(), changeSet, now);
            return outcome.ok() ? withActivation(outcome, activation.activate(context)) : outcome;
        } catch (RuntimeException e) {
            return PolicyBodies.unavailable();
        } finally {
            if (principal != null && principal.runId() != null) {
                source.invalidate(principal.runId());
            }
        }
    }

    static PolicyResult unsupported() {
        ObjectNode fields = PolicyBodies.fields();
        fields.put("code", "unsupported-operation");
        fields.put("accepted", false);
        fields.putArray("reasons").addObject().put("field", "publishPolicyVersion")
                .put("reason", "The file policy provider is read-only.");
        return PolicyBodies.result("invalid", null, fields);
    }

    private PolicyResult execute(RunContext context, String publisher, JsonNode changeSet,
            String now) {
        Refusal refusal = new Refusal();
        Outcome outcome = database.runner().execute(context,
                new Command(COMMAND_TYPE, changeSet.get("commandId").textValue(), changeSet), tx -> {
                    Connection c = tx.connection();
                    PolicyRecords.lockRun(c, context.environmentId(), context.runId());
                    List<ObjectNode> seeds;
                    try {
                        seeds = new ArrayList<>(PolicyRecords.seeds(c, context.environmentId(), context.runId()));
                        if (seeds.isEmpty()) {
                            ObjectNode base = PolicyRecords.baseSeed(this.base, context.runId());
                            PolicyRecords.insertBase(tx::write, context.environmentId(), context.runId(), base);
                            seeds.add(base);
                        }
                        PolicyValidation.snapshot(new ArrayList<JsonNode>(seeds));
                    } catch (PolicySourceException e) {
                        refusal.result = PolicyBodies.sourceFailure(e);
                        return WorkResult.refuse(e.code(), "The policy source could not be loaded.");
                    }
                    PolicyPublication.Published published = PolicyPublication.preparePublication(seeds, changeSet,
                            publisher, now);
                    if (published.seed() == null) {
                        refusal.result = published.outcome();
                        return WorkResult.refuse(published.outcome().status(), "The change set was refused.");
                    }
                    ObjectNode seed = published.seed();
                    String digest = PolicyDigest.of(seed);
                    Instant from = Instant.ofEpochMilli(PolicyTime.parse(seed.get("effectiveFrom").textValue()).getAsLong());
                    Instant at = Instant.ofEpochMilli(PolicyTime.parse(now).getAsLong());
                    tx.write(PolicyRecords.INSERT_DOCUMENT, digest, seed);
                    tx.write(PolicyRecords.INSERT_VERSION, context.environmentId(), context.runId(),
                            seed.get("policyVersion").textValue(), from, digest, published.sourceVersion(), publisher, at,
                            changeSet.get("commandId").textValue(), null);
                    return WorkResult.ok(published.outcome().body());
                });
        return map(outcome, refusal);
    }

    private static PolicyResult map(Outcome outcome, Refusal refusal) {
        if (outcome instanceof Outcome.Committed committed) {
            JsonNode body = committed.result();
            if (body instanceof ObjectNode object && body.hasNonNull("status")) {
                JsonNode version = body.get("policyVersion");
                return new PolicyResult(body.get("status").textValue(),
                        version == null || version.isNull() ? null : version.textValue(), object.deepCopy());
            }
            return PolicyBodies.unavailable();
        }
        if (outcome instanceof Outcome.Refused refused && refusal.result != null) {
            return refusal.result;
        }
        if (outcome instanceof Outcome.Conflict conflict) {
            return PolicyBodies.conflict(conflict.code(), "stale-run".equals(conflict.code())
                    ? PolicyBodies.STALE_RUN_REASON : conflict.message(), conflict.retryable());
        }
        if (outcome instanceof Outcome.Uncertain uncertain) {
            return PolicyBodies.uncertain(uncertain.operationId());
        }
        return PolicyBodies.unavailable();
    }

    /** Adds activationRequired and the activation summary to an accepted publication, as the Node route does. */
    static PolicyResult withActivation(PolicyResult published, PolicyResult activated) {
        ObjectNode body = published.body().deepCopy();
        ObjectNode value = (ObjectNode) body.get("value");
        boolean active = activated.ok();
        value.put("activationRequired", !active);
        ObjectNode summary = value.putObject("activation");
        if (active) {
            String version = activated.value().get("policyVersion").textValue();
            summary.put("status", "active");
            summary.put("policyVersion", version);
            summary.put("asOf", activated.value().get("asOf").textValue());
            summary.put("publishedVersionActive", version.equals(value.get("policyVersion").textValue()));
        } else {
            summary.put("status", "pending");
            summary.put("policyVersion", value.get("policyVersion").textValue());
            summary.put("retryable", true);
            summary.put("reason", "Publication was saved. Retry to activate the run.");
            summary.put("outcome", activated.status());
        }
        return new PolicyResult(published.status(), published.policyVersion(), body);
    }

    /** Non-finite numbers cannot be digested or stored, so the change set must not carry any. */
    private static boolean finite(JsonNode node) {
        if (node.isNumber()) {
            return Double.isFinite(node.doubleValue());
        }
        for (JsonNode child : node) {
            if (!finite(child)) {
                return false;
            }
        }
        return true;
    }
}
