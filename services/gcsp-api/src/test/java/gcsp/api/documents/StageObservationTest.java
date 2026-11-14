package gcsp.api.documents;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.documents.DocumentCasePort.StageRead;
import gcsp.api.documents.StageObservation.Observed;
import org.junit.jupiter.api.Test;

class StageObservationTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** A valid read with no renewal authority, the opening stage approved and its policy nested as the producer sends it. */
    private static ObjectNode stage() {
        ObjectNode v = MAPPER.createObjectNode();
        v.put("contractVersion", "lifecycle.stages.v1");
        v.put("runId", "run-1");
        v.put("orderUuid", "order-1");
        v.put("employeeId", "E-1001");
        v.put("renewalAuthority", "missing");
        v.putNull("renewalId");
        v.putNull("entitlementSlotId");
        v.put("lifecycleRevision", 7);
        v.putObject("policy").put("policyVersion", "gcsp-policy-v1");
        ObjectNode row = v.putArray("stages").addObject();
        row.put("stage", "sent to ordering");
        row.put("state", "approved");
        row.put("at", "2026-11-14T09:30:00Z");
        row.put("providerReference", "PR-1");
        return v;
    }

    private static ObjectNode row(ObjectNode v) {
        return (ObjectNode) v.get("stages").get(0);
    }

    private static Observed observeRead(StageRead read) {
        return StageObservation.observe(read, "run-1", "order-1", "sent to ordering", "approved");
    }

    private static Observed observeValue(JsonNode value) {
        return observeRead(new StageRead("ok", null, value));
    }

    private static Observed.NotOpen notOpen(Observed observed) {
        return assertInstanceOf(Observed.NotOpen.class, observed);
    }

    @Test
    void openReturnsTheObservationAndTheOrdersAuthority() {
        Observed.Open open = assertInstanceOf(Observed.Open.class, observeValue(stage()));
        assertEquals("E-1001", open.employeeId());
        assertNull(open.order().entitlementSlotId());
        assertNull(open.order().renewalId());
        assertEquals("missing", open.order().renewalAuthority());
        assertEquals("lifecycle.stages.v1", open.observation().get("contractVersion").asText());
        assertEquals("sent to ordering", open.observation().get("stage").asText());
        assertEquals("approved", open.observation().get("state").asText());
        assertEquals("2026-11-14T09:30:00Z", open.observation().get("stageAt").asText());
        assertEquals("PR-1", open.observation().get("providerReference").asText());
        assertEquals(7, open.observation().get("lifecycleRevision").asInt());
        assertEquals("gcsp-policy-v1", open.observation().get("stagePolicyVersion").asText());
    }

    @Test
    void validatedAuthorityCarriesTheOrdersOwnSlotAndRenewal() {
        ObjectNode v = stage();
        v.put("renewalAuthority", "validated");
        v.put("entitlementSlotId", "SLOT-1");
        v.put("renewalId", "REN-1");
        Observed.Open open = assertInstanceOf(Observed.Open.class, observeValue(v));
        assertEquals("SLOT-1", open.order().entitlementSlotId());
        assertEquals("REN-1", open.order().renewalId());
        assertEquals("validated", open.order().renewalAuthority());
    }

    @Test
    void topLevelPolicyVersionIsReadWhenThePolicyObjectIsAbsent() {
        ObjectNode v = stage();
        v.remove("policy");
        v.put("policyVersion", "gcsp-policy-v2");
        Observed.Open open = assertInstanceOf(Observed.Open.class, observeValue(v));
        assertEquals("gcsp-policy-v2", open.observation().get("stagePolicyVersion").asText());
    }

    @Test
    void absentOrUnknownReadsAreNotOpen() {
        assertEquals("stage-read-unavailable", notOpen(observeRead(null)).reason());
        assertEquals("stage-read-unavailable", notOpen(observeRead(new StageRead(null, null, null))).reason());
        assertEquals("no-lifecycle-for-order", notOpen(observeRead(new StageRead("not-found", null, null))).reason());
        assertEquals("stage-mode-unsupported", notOpen(observeRead(new StageRead("unsupported", null, null))).reason());
    }

    @Test
    void forbiddenReadIsForbidden() {
        Observed.Forbidden forbidden = assertInstanceOf(Observed.Forbidden.class,
                observeRead(new StageRead("forbidden", null, null)));
        assertEquals("stage-read-forbidden", forbidden.reason());
    }

    @Test
    void failedReadKeepsTheProducersStatusAndCode() {
        Observed.NotOpen failed = notOpen(observeRead(new StageRead("unavailable", "producer-down", null)));
        assertEquals("stage-read-unavailable", failed.reason());
        assertEquals("unavailable", failed.producerStatus());
        assertEquals("producer-down", failed.producerCode());
        Observed.NotOpen notObject = notOpen(observeRead(new StageRead("ok", null, MAPPER.createArrayNode())));
        assertEquals("stage-read-unavailable", notObject.reason());
        assertEquals("ok", notObject.producerStatus());
        assertNull(notObject.producerCode());
    }

    @Test
    void otherContractVersionIsUnsupported() {
        ObjectNode v = stage();
        v.put("contractVersion", "lifecycle.stages.v0");
        assertEquals("stage-contract-unsupported", notOpen(observeValue(v)).reason());
    }

    @Test
    void readForAnotherRunOrOrderIsAnIdentityMismatch() {
        ObjectNode otherRun = stage();
        otherRun.put("runId", "run-2");
        assertEquals("stage-identity-mismatch", notOpen(observeValue(otherRun)).reason());
        ObjectNode otherOrder = stage();
        otherOrder.put("orderUuid", "order-2");
        assertEquals("stage-identity-mismatch", notOpen(observeValue(otherOrder)).reason());
        ObjectNode noEmployee = stage();
        noEmployee.remove("employeeId");
        assertEquals("stage-identity-mismatch", notOpen(observeValue(noEmployee)).reason());
    }

    @Test
    void validatedAuthorityWithoutTheRenewalIsInvalid() {
        ObjectNode v = stage();
        v.put("renewalAuthority", "validated");
        Observed.NotOpen n = notOpen(observeValue(v));
        assertEquals("stage-renewal-authority-invalid", n.reason());
        assertEquals("E-1001", n.employeeId());
    }

    @Test
    void missingRevisionOrPolicyVersionIsRevisionMissing() {
        ObjectNode noRevision = stage();
        noRevision.put("lifecycleRevision", 0);
        Observed.NotOpen n = notOpen(observeValue(noRevision));
        assertEquals("stage-revision-missing", n.reason());
        assertEquals("E-1001", n.employeeId());
        ObjectNode noPolicy = stage();
        noPolicy.remove("policy");
        assertEquals("stage-revision-missing", notOpen(observeValue(noPolicy)).reason());
    }

    @Test
    void stagesThatAreNotAnArrayAreUnavailable() {
        ObjectNode v = stage();
        v.put("stages", "sent to ordering");
        Observed.NotOpen n = notOpen(observeValue(v));
        assertEquals("stage-read-unavailable", n.reason());
        assertEquals("E-1001", n.employeeId());
    }

    @Test
    void absentOpeningStageIsNotInTheLifecycle() {
        ObjectNode v = stage();
        row(v).put("stage", "delivered");
        Observed.NotOpen n = notOpen(observeValue(v));
        assertEquals("opening-stage-not-in-lifecycle", n.reason());
        assertEquals("E-1001", n.employeeId());
        assertEquals(Long.valueOf(7), n.lifecycleRevision());
    }

    @Test
    void openingStageNotApprovedIsNotReached() {
        ObjectNode v = stage();
        row(v).put("state", "pending");
        Observed.NotOpen n = notOpen(observeValue(v));
        assertEquals("opening-stage-not-reached", n.reason());
        assertEquals("E-1001", n.employeeId());
        assertEquals(Long.valueOf(7), n.lifecycleRevision());
        assertEquals("pending", n.stageState());
    }

    @Test
    void impossibleStageTimeIsNotReached() {
        ObjectNode v = stage();
        row(v).put("at", "2026-02-30T09:30:00Z");
        Observed.NotOpen n = notOpen(observeValue(v));
        assertEquals("opening-stage-not-reached", n.reason());
        assertEquals("approved", n.stageState());
    }
}
