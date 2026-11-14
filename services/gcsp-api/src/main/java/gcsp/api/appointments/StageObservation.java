package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;

/** Port of Node observeStage (lifecycle/documents/index.js): classifies one stage read, never fabricating approval. */
public sealed interface StageObservation {

    String CONTRACT = "lifecycle.stages.v1";

    /** The opening stage is approved with a valid instant. */
    record Open(String employeeId, Order order, Observed observation) implements StageObservation {}

    /** Not open, with the Node reason; employeeId is carried once the order is identified. */
    record NotOpen(String reason, String employeeId, Long lifecycleRevision, String stageState, String producerStatus,
            String producerCode) implements StageObservation {}

    record Forbidden(String reason) implements StageObservation {}

    record Order(String entitlementSlotId, String renewalId, String renewalAuthority) {}

    record Observed(String contractVersion, String stage, String state, String stageAt, String providerReference,
            long lifecycleRevision, String stagePolicyVersion) {}

    static StageObservation classify(StageRead read, String runId, String orderUuid, String openingStage,
            String openingState) {
        if (read == null) return notOpen("stage-read-unavailable");
        if (read instanceof StageRead.NotFound) return notOpen("no-lifecycle-for-order");
        if (read instanceof StageRead.Unsupported) return notOpen("stage-mode-unsupported");
        if (read instanceof StageRead.Forbidden) return new Forbidden("stage-read-forbidden");
        if (read instanceof StageRead.Unavailable u) {
            return new NotOpen("stage-read-unavailable", null, null, null, u.status(), u.code());
        }
        JsonNode v = ((StageRead.Ok) read).value();
        if (!Values.object(v)) return notOpen("stage-read-unavailable");
        if (!CONTRACT.equals(v.path("contractVersion").asText(null))) return notOpen("stage-contract-unsupported");
        if (!runId.equals(v.path("runId").asText(null)) || !orderUuid.equals(v.path("orderUuid").asText(null))
                || !Values.id(v.get("employeeId"), 128)) return notOpen("stage-identity-mismatch");
        String employeeId = v.get("employeeId").asText();
        String slotId = v.path("entitlementSlotId").isTextual() ? v.get("entitlementSlotId").asText() : null;
        String renewalId = v.path("renewalId").isTextual() ? v.get("renewalId").asText() : null;
        String authority = v.path("renewalAuthority").asText(null);
        boolean validated = "validated".equals(authority) && Values.id(v.get("entitlementSlotId"), 128)
                && Values.id(v.get("renewalId"), 128);
        boolean missing = "missing".equals(authority) && Values.missing(v.get("renewalId"))
                && (Values.missing(v.get("entitlementSlotId")) || Values.id(v.get("entitlementSlotId"), 128));
        if (!validated && !missing) return carry("stage-renewal-authority-invalid", employeeId, null, null);
        Order order = new Order(slotId, renewalId, authority);
        String policyVersion = textOrNull(v.get("policyVersion"));
        if (policyVersion == null && v.path("policy").isObject()) policyVersion = textOrNull(v.get("policy").get("policyVersion"));
        Long rev = Values.integer(v.get("lifecycleRevision"));
        if (rev == null || rev <= 0 || policyVersion == null || policyVersion.isEmpty() || policyVersion.length() > 128) {
            return carry("stage-revision-missing", employeeId, null, null);
        }
        if (!v.path("stages").isArray()) return carry("stage-read-unavailable", employeeId, null, null);
        JsonNode stage = null;
        for (JsonNode row : v.get("stages")) {
            if (row != null && row.isObject() && openingStage.equals(row.path("stage").asText(null))) {
                stage = row;
                break;
            }
        }
        if (stage == null) return carry("opening-stage-not-in-lifecycle", employeeId, rev, null);
        String state = textOrNull(stage.get("state"));
        if (!openingState.equals(state) || !Iso.valid(textOrNull(stage.get("at")))) {
            return carry("opening-stage-not-reached", employeeId, rev, state);
        }
        return new Open(employeeId, order, new Observed(CONTRACT, openingStage, state, stage.get("at").asText(),
                stage.path("providerReference").isMissingNode() || stage.get("providerReference").isNull() ? null
                        : stage.get("providerReference").asText(), rev, policyVersion));
    }

    private static NotOpen notOpen(String reason) {
        return new NotOpen(reason, null, null, null, null, null);
    }

    private static NotOpen carry(String reason, String employeeId, Long revision, String stageState) {
        return new NotOpen(reason, employeeId, revision, stageState, null, null);
    }

    private static String textOrNull(JsonNode n) {
        return n != null && n.isTextual() ? n.asText() : null;
    }
}
