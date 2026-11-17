package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.WorkResult;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Adopts a reviewed definition set into a run as a new successor policy version (port of prepareReviewedAdoption in
 * server/gcsp/policy/adoption.js). Trusted startup composition only: there is no HTTP route.
 */
@ApplicationScoped
public class PolicyAdoption {

    static final String COMMAND_TYPE = "policy.adopt-reviewed";
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    /** status is adopted, present (target version already existed), nothing-to-adopt, refused or unavailable. */
    public record Result(String status, String policyVersion, String detail, boolean written, PolicyResult activation) {

        public boolean ok() {
            return "adopted".equals(status) || "present".equals(status);
        }
    }

    /** What a refused work callback leaves for the caller. */
    private static final class Refusal {
        String status = "refused";
        String detail;
    }

    private final PolicySource source;
    private final RetainedFilePolicySource base;
    private final PolicyDatabase database;
    private final PolicyActivation activation;

    @Inject
    public PolicyAdoption(PolicySource source, RetainedFilePolicySource base, PolicyDatabase database,
            PolicyActivation activation) {
        this.source = source;
        this.base = base;
        this.database = database;
        this.activation = activation;
    }

    public static String commandId(String definitionSetId, String runId) {
        return "adopt:" + definitionSetId + ":" + runId;
    }

    public Result adopt(RunContext context, String definitionSetId, String targetVersion, Instant now) {
        return adopt(context, definitionSetId, targetVersion, now, null);
    }

    /**
     * Adopts the set as targetVersion, effective at now; a replay or an existing target version writes nothing.
     * A non-null expectedBase must be the version in force at now, or nothing is written.
     */
    public Result adopt(RunContext context, String definitionSetId, String targetVersion, Instant now,
            String expectedBase) {
        if (!database.active()) {
            return new Result("unavailable", null, "Persistence is not configured.", false, null);
        }
        try {
            ObjectNode bundle = ReviewedDefinitions.get(definitionSetId);
            if (bundle == null) {
                return new Result("refused", null, "Unknown reviewed definition set " + definitionSetId + ".", false, null);
            }
            Refusal refusal = new Refusal();
            Outcome outcome = execute(context, bundle, targetVersion, now, expectedBase, refusal);
            Result result = map(outcome, refusal, targetVersion);
            if (!result.ok()) {
                return result;
            }
            return new Result(result.status(), result.policyVersion(), result.detail(), result.written(),
                    activation.activate(context));
        } catch (PolicySourceException e) {
            return new Result("unavailable", null, "The reviewed definitions could not be loaded (" + e.code() + ").",
                    false, null);
        } catch (RuntimeException e) {
            return new Result("unavailable", null, "Adoption failed (" + e.getClass().getSimpleName() + ").", false, null);
        } finally {
            source.invalidate(context.runId());
        }
    }

    private Outcome execute(RunContext context, ObjectNode bundle, String targetVersion, Instant now,
            String expectedBase, Refusal refusal) {
        String nowText = PolicyClock.iso(now);
        String definitionSetId = bundle.get("definitionSetId").textValue();
        ObjectNode commandInput = JSON.objectNode();
        commandInput.put("definitionSetId", definitionSetId);
        commandInput.put("digest", bundle.get("digest").textValue());
        commandInput.put("policyVersion", targetVersion);
        Command command = new Command(COMMAND_TYPE, commandId(definitionSetId, context.runId()), commandInput);
        return database.runner().execute(context, command, tx -> {
            Connection c = tx.connection();
            PolicyRecords.lockRun(c, context.environmentId(), context.runId());
            List<ObjectNode> seeds;
            try {
                seeds = new ArrayList<>(PolicyRecords.seeds(c, context.environmentId(), context.runId()));
                if (seeds.isEmpty()) {
                    ObjectNode retained = PolicyRecords.baseSeed(this.base, context.runId());
                    PolicyRecords.insertBase(tx::write, context.environmentId(), context.runId(), retained);
                    seeds.add(retained);
                }
                PolicyValidation.snapshot(new ArrayList<JsonNode>(seeds));
            } catch (PolicySourceException e) {
                refusal.detail = "The policy source could not be loaded (" + e.code() + ").";
                return WorkResult.refuse(e.code(), refusal.detail);
            }
            for (ObjectNode seed : seeds) {
                if (targetVersion.equals(seed.get("policyVersion").textValue())) {
                    return WorkResult.ok(result("present", targetVersion));
                }
            }
            long nowMillis = PolicyTime.parse(nowText).getAsLong();
            ObjectNode active = PolicyPublication.activeAt(seeds, nowMillis);
            if (expectedBase != null && (active == null || !expectedBase.equals(active.get("policyVersion").textValue()))) {
                refusal.detail = expectedBase + " is not the version in force at " + nowText + " (it is "
                        + (active == null ? "none" : active.get("policyVersion").textValue()) + ").";
                return WorkResult.refuse("stale-version", refusal.detail);
            }
            ObjectNode input = JSON.objectNode();
            input.put("expectedActiveVersion", active == null ? "" : active.get("policyVersion").textValue());
            input.put("policyVersion", targetVersion);
            input.put("effectiveFrom", nowText);
            PolicyPublication.Successor successor = PolicyPublication.prepareSuccessor(seeds, input, nowText);
            if (successor.outcome() != null) {
                refusal.detail = "No policy version is in force at " + nowText + ", or " + targetVersion
                        + " cannot be dated at or after it and later than every retained version.";
                return WorkResult.refuse(successor.outcome().status(), refusal.detail);
            }
            ObjectNode next = successor.next();
            Set<String> existing = new HashSet<>();
            next.get("assumptions").forEach(row -> existing.add(row.path("key").asText()));
            ArrayNode added = JSON.arrayNode();
            ArrayNode keys = JSON.arrayNode();
            for (JsonNode definition : bundle.get("definitions")) {
                if (!existing.contains(definition.get("key").textValue())) {
                    ObjectNode row = ((ObjectNode) definition).deepCopy();
                    row.put("policyVersion", targetVersion);
                    row.put("effectiveFrom", nowText);
                    added.add(row);
                    keys.add(definition.get("key").textValue());
                }
            }
            if (added.isEmpty()) {
                refusal.status = "nothing-to-adopt";
                refusal.detail = "Every reviewed key already exists in " + active.get("policyVersion").textValue() + ".";
                return WorkResult.refuse("nothing-to-adopt", refusal.detail);
            }
            ((ArrayNode) next.get("assumptions")).addAll(added);
            ObjectNode adoption = JSON.objectNode();
            adoption.put("definitionSetId", definitionSetId);
            adoption.put("revision", bundle.get("revision").textValue());
            adoption.put("digest", bundle.get("digest").textValue());
            adoption.set("addedKeys", keys);
            PolicyPublication.Published published = PolicyPublication.completePublication(seeds, successor,
                    context.actorId(), nowText, adoption);
            if (published.seed() == null) {
                refusal.detail = "The adopted policy does not satisfy the seed schema, dates, references and provenance.";
                return WorkResult.refuse(published.outcome().status(), refusal.detail);
            }
            ObjectNode seed = published.seed();
            String digest = PolicyDigest.of(seed);
            Instant from = Instant.ofEpochMilli(PolicyTime.parse(seed.get("effectiveFrom").textValue()).getAsLong());
            tx.write(PolicyRecords.INSERT_DOCUMENT, digest, seed);
            tx.write(PolicyRecords.INSERT_VERSION, context.environmentId(), context.runId(), targetVersion, from, digest,
                    published.sourceVersion(), context.actorId(), Instant.ofEpochMilli(nowMillis), command.commandId(),
                    adoption);
            return WorkResult.ok(result("adopted", targetVersion));
        });
    }

    private static ObjectNode result(String status, String version) {
        ObjectNode body = JSON.objectNode();
        body.put("status", status);
        body.put("policyVersion", version);
        return body;
    }

    private static Result map(Outcome outcome, Refusal refusal, String targetVersion) {
        if (outcome instanceof Outcome.Committed committed) {
            String status = committed.result().path("status").asText("");
            if ("adopted".equals(status) || "present".equals(status)) {
                // A stored receipt answered: the adoption happened earlier, so nothing was written now.
                if (committed.replayed()) status = "present";
                return new Result(status, targetVersion, null, committed.changed() && "adopted".equals(status), null);
            }
            return new Result("unavailable", null, "The stored adoption result is unreadable.", false, null);
        }
        if (outcome instanceof Outcome.Refused refused) {
            return new Result(refusal.status, null, refusal.detail != null ? refusal.detail : refused.message(), false, null);
        }
        if (outcome instanceof Outcome.Conflict conflict) {
            return new Result("refused", null, conflict.code() + ": " + conflict.message(), false, null);
        }
        return new Result("unavailable", null, "The database could not complete the adoption (" + outcome.code() + ").",
                false, null);
    }
}
