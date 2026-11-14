package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.regex.Pattern;

/** Classifies one lifecycle stage read in the Node observeStage order; never fabricates an approved stage. */
public final class StageObservation {

    public static final String STAGE_CONTRACT = "lifecycle.stages.v1";
    private static final Pattern INSTANT = Pattern.compile(
            "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})");

    private StageObservation() {}

    public sealed interface Observed {

        record Open(String employeeId, DocumentCasePort.OrderAuthority order, ObjectNode observation)
                implements Observed {}

        record NotOpen(String reason, String employeeId, Long lifecycleRevision, String stageState,
                String producerStatus, String producerCode) implements Observed {}

        record Forbidden(String reason) implements Observed {}
    }

    /** Classifies the read with the Node reasons, checked in the same order. */
    public static Observed observe(DocumentCasePort.StageRead read, String runId, String orderUuid,
            String openingStage, String openingState) {
        if (read == null || read.status() == null) return notOpen("stage-read-unavailable");
        if ("not-found".equals(read.status())) return notOpen("no-lifecycle-for-order");
        if ("unsupported".equals(read.status())) return notOpen("stage-mode-unsupported");
        if ("forbidden".equals(read.status())) return new Observed.Forbidden("stage-read-forbidden");
        JsonNode v = read.value();
        if (!"ok".equals(read.status()) || !DocumentPolicy.isObject(v)) {
            return new Observed.NotOpen("stage-read-unavailable", null, null, null, read.status(), read.code());
        }
        if (!STAGE_CONTRACT.equals(DocumentPolicy.str(v.get("contractVersion")))) {
            return notOpen("stage-contract-unsupported");
        }
        String employeeId = DocumentPolicy.str(v.get("employeeId"));
        if (!same(runId, DocumentPolicy.str(v.get("runId")))
                || !same(orderUuid, DocumentPolicy.str(v.get("orderUuid"))) || !text(employeeId, 128)) {
            return notOpen("stage-identity-mismatch");
        }
        // The producer's own renewal authority; never replaced by the employee's default slot.
        String renewalAuthority = DocumentPolicy.str(v.get("renewalAuthority"));
        JsonNode slot = v.get("entitlementSlotId");
        JsonNode renewal = v.get("renewalId");
        boolean validated = "validated".equals(renewalAuthority) && text(DocumentPolicy.str(slot), 128)
                && text(DocumentPolicy.str(renewal), 128);
        boolean missing = "missing".equals(renewalAuthority) && nullish(renewal)
                && (nullish(slot) || text(DocumentPolicy.str(slot), 128));
        if (!validated && !missing) return notOpen("stage-renewal-authority-invalid", employeeId, null, null);
        DocumentCasePort.OrderAuthority order = new DocumentCasePort.OrderAuthority(DocumentPolicy.str(slot),
                DocumentPolicy.str(renewal), renewalAuthority);
        // The producer nests its pins under policy; a top-level policyVersion is accepted too.
        JsonNode pinned = nullish(v.get("policyVersion")) ? nested(v.get("policy"), "policyVersion")
                : v.get("policyVersion");
        String policyVersion = DocumentPolicy.str(pinned);
        Long revision = DocumentPolicy.safeInteger(v.get("lifecycleRevision"));
        if (revision == null || revision <= 0 || !text(policyVersion, 128)) {
            return notOpen("stage-revision-missing", employeeId, null, null);
        }
        JsonNode stages = v.get("stages");
        if (!DocumentPolicy.isArray(stages)) return notOpen("stage-read-unavailable", employeeId, null, null);
        JsonNode stage = null;
        for (JsonNode row : stages) {
            if (DocumentPolicy.isObject(row) && same(openingStage, DocumentPolicy.str(row.get("stage")))) {
                stage = row;
                break;
            }
        }
        if (stage == null) return notOpen("opening-stage-not-in-lifecycle", employeeId, revision, null);
        String state = DocumentPolicy.str(stage.get("state"));
        String at = DocumentPolicy.str(stage.get("at"));
        if (!same(openingState, state) || !validInstant(at)) {
            return notOpen("opening-stage-not-reached", employeeId, revision, state);
        }
        ObjectNode observation = JsonNodeFactory.instance.objectNode();
        observation.put("contractVersion", STAGE_CONTRACT);
        observation.put("stage", openingStage);
        observation.put("state", state);
        observation.put("stageAt", at);
        JsonNode reference = stage.get("providerReference");
        observation.set("providerReference", reference == null ? NullNode.instance : reference);
        observation.put("lifecycleRevision", revision);
        observation.put("stagePolicyVersion", policyVersion);
        return new Observed.Open(employeeId, order, observation);
    }

    private static Observed notOpen(String reason) {
        return new Observed.NotOpen(reason, null, null, null, null, null);
    }

    private static Observed notOpen(String reason, String employeeId, Long revision, String stageState) {
        return new Observed.NotOpen(reason, employeeId, revision, stageState, null, null);
    }

    private static boolean same(String expected, String actual) {
        return expected != null && expected.equals(actual);
    }

    private static boolean text(String value, int max) {
        return value != null && !value.isEmpty() && value.length() <= max;
    }

    private static boolean nullish(JsonNode node) {
        return node == null || node.isNull();
    }

    private static JsonNode nested(JsonNode parent, String name) {
        return DocumentPolicy.isObject(parent) ? parent.get(name) : null;
    }

    /** The regex, then OffsetDateTime.parse, which rejects impossible dates, clock values and offsets. */
    private static boolean validInstant(String value) {
        if (value == null || !INSTANT.matcher(value).matches()) return false;
        try {
            OffsetDateTime.parse(value);
            return true;
        } catch (DateTimeParseException e) {
            return false;
        }
    }
}
