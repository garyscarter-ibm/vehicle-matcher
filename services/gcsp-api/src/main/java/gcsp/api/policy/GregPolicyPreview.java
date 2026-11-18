package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.demand.DemandResult;
import gcsp.api.demand.DemandScope;
import gcsp.api.demand.DemandService;
import gcsp.api.demand.DemandServices;
import gcsp.api.demand.PolicyDemandAdapter;
import gcsp.api.identity.Principal;
import gcsp.api.recommendation.RecommendationCandidates;
import gcsp.api.recommendation.SelectedAccountCandidates;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Optional;

/** Greg's policy preview (Node greg/publish preview): the change set on an in-memory draft version, never stored. */
@ApplicationScoped
class GregPolicyPreview {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final List<String> VERSIONED_TABLES =
            List.of("schemeRuleLinks", "eligibilityRules", "pricePlans", "allowances", "assumptions");

    @Inject
    PolicyService policy;

    @Inject
    DemandServices demand;

    @Inject
    RunClockHolder clockHolder;

    @Inject
    AccountRecordsPort records;

    /** The preview of a JSON-object body at the instant now; any unexpected failure is the controls-unavailable 503. */
    Response preview(Principal principal, String now, ObjectNode input) {
        try {
            return run(principal, now, input);
        } catch (RuntimeException e) {
            return PolicyResponses.controlsUnavailable();
        }
    }

    private Response run(Principal principal, String now, ObjectNode input) {
        ClockReading start = runClock(principal);
        if (start == null) {
            return PolicyResponses.controlsUnavailable();
        }
        PolicyResult snapshot = policy.getPolicySnapshot(new PolicyRead(principal.runId(), now, null));
        if (!snapshot.ok()) {
            return PolicyResponses.failure(snapshot);
        }
        ObjectNode seed = (ObjectNode) snapshot.value();
        GregPolicyProjection.Prepared prepared = prepare(seed, PolicyTime.parse(now).getAsLong(), input);
        if (prepared.error() != null) {
            return PolicyResponses.failure(prepared.error());
        }
        String active = seed.get("policyVersion").textValue();
        ObjectNode draft = draft(seed, prepared);
        String draftVersion = draft.get("policyVersion").textValue();
        PolicyService draftPolicy = new PolicyService(runId -> List.of(draft));

        Optional<DemandService> activeDemand = demand.demand();
        Optional<DemandService> draftDemand = demand.demandWith(new PolicyDemandAdapter(draftPolicy,
                Optional.of(principal.runId())), draftCandidates(draftPolicy));
        if (activeDemand.isEmpty() || draftDemand.isEmpty()) {
            return PolicyResponses.controlsUnavailable();
        }
        DemandService.Fitted before =
                activeDemand.get().readWithFit(new DemandScope(principal.environmentId(), principal.runId(), active));
        if (before.demand() instanceof DemandResult.Refusal refusal) {
            return refused(refusal);
        }
        DemandService.Fitted after =
                draftDemand.get().readWithFit(new DemandScope(principal.environmentId(), principal.runId(), draftVersion));
        if (after.demand() instanceof DemandResult.Refusal refusal) {
            return refused(refusal);
        }

        Response unstable = unstable(principal, now, start, active);
        if (unstable != null) {
            return unstable;
        }
        ObjectNode value = JSON.objectNode();
        value.put("state", "preview-ready");
        value.put("preview", true);
        value.put("activeVersion", active);
        value.put("draftVersion", draftVersion);
        value.put("asOf", now);
        value.put("clockVersion", start.clockVersion());
        value.set("differences", prepared.differences());
        value.set("active", side(before));
        value.set("draft", side(after));
        value.set("heldOffers", GregPolicyProjection.heldOffersUnknown());
        return PolicyResponses.ok(value);
    }

    /** The validated change set, or Node's invalid or stale-version outcome when the body is not for the active version. */
    static GregPolicyProjection.Prepared prepare(ObjectNode seed, long now, ObjectNode input) {
        GregPolicyProjection.Prepared prepared = GregPolicyProjection.changesFor(seed, now, input, false);
        String active = seed.get("policyVersion").textValue();
        String expected = input.path("expectedActiveVersion").textValue();
        if (prepared.error() != null || expected.equals(active)) {
            return prepared;
        }
        return new GregPolicyProjection.Prepared(PolicyBodies.previewStale(expected, active), null, null);
    }

    /** One side of the comparison: that version's demand projection and its recommendation fit. */
    private static ObjectNode side(DemandService.Fitted read) {
        ObjectNode side = JSON.objectNode();
        side.set("demand", ((DemandResult.Ok) read.demand()).value());
        side.set("fit", read.fit());
        return side;
    }

    private EligibleCandidates draftCandidates(PolicyService draftPolicy) {
        return new SelectedAccountCandidates(new RecommendationCandidates(draftPolicy), records);
    }

    /** The active seed deep-copied under the preview version with the patches applied; the digest names it by its changes. */
    static ObjectNode draft(ObjectNode seed, GregPolicyProjection.Prepared prepared) {
        ObjectNode digestInput = JSON.objectNode();
        digestInput.put("activeVersion", seed.get("policyVersion").textValue());
        digestInput.set("changes", prepared.differences());
        String version = "preview-" + PolicyDigest.of(digestInput).substring(0, 24);
        ObjectNode draft = seed.deepCopy();
        draft.put("policyVersion", version);
        for (String table : VERSIONED_TABLES) {
            for (JsonNode row : draft.get(table)) {
                ((ObjectNode) row).put("policyVersion", version);
            }
        }
        for (JsonNode change : prepared.changes()) {
            ObjectNode target = null;
            for (JsonNode row : draft.get(change.get("table").textValue())) {
                if (change.get("key").textValue().equals(row.path("key").asText(null))) {
                    target = (ObjectNode) row;
                    break;
                }
            }
            if (target == null) {
                throw new IllegalStateException("No row to patch");
            }
            target.setAll((ObjectNode) change.get("patch"));
        }
        return draft;
    }

    /** Node stable(): the clock and the active version must be as they were when the preview began. */
    private Response unstable(Principal principal, String now, ClockReading start, String active) {
        ClockReading end = runClock(principal);
        if (end == null) {
            return PolicyResponses.controlsUnavailable();
        }
        if (end.clockVersion() != start.clockVersion()) {
            return PolicyResponses.failure(PolicyBodies.conflict("preview-inputs-changed",
                    "Inputs changed. Refresh the policy controls.", false));
        }
        PolicyResult current = policy.getActiveVersion(new PolicyRead(principal.runId(), now, null));
        if (!current.ok()) {
            return PolicyResponses.failure(current);
        }
        String latest = current.value().get("policyVersion").textValue();
        return active.equals(latest) ? null : PolicyResponses.failure(PolicyBodies.stale(active, latest));
    }

    private ClockReading runClock(Principal principal) {
        try {
            return clockHolder.clock().now(principal.environmentId(), principal.runId()).orElse(null);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Response refused(DemandResult.Refusal refusal) {
        return PolicyResponses.raw(refusal.http(), refusal.body());
    }
}
