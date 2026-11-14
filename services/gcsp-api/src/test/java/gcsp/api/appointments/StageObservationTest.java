package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

class StageObservationTest {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String ORDER = "7d1c0b6e-2f4a-4c1e-9b7a-1a2b3c4d5e6f";

    ObjectNode view() {
        ObjectNode v = JSON.createObjectNode();
        v.put("contractVersion", "lifecycle.stages.v1").put("runId", "run-1").put("orderUuid", ORDER)
                .put("employeeId", "paula").put("renewalAuthority", "validated").put("entitlementSlotId", "slot-1")
                .put("renewalId", "ren-1").put("lifecycleRevision", 3);
        v.putObject("policy").put("policyVersion", "gcsp-policy-v1");
        v.putArray("stages").addObject().put("stage", "sent to ordering").put("state", "approved")
                .put("at", "2026-11-05T09:00:00.000Z").put("providerReference", "ORD-1");
        return v;
    }

    StageObservation classify(StageRead read) {
        return StageObservation.classify(read, "run-1", ORDER, "sent to ordering", "approved");
    }

    StageObservation.NotOpen notOpen(Consumer<ObjectNode> edit, String reason) {
        ObjectNode v = view();
        edit.accept(v);
        StageObservation.NotOpen n = assertInstanceOf(StageObservation.NotOpen.class, classify(new StageRead.Ok(v)));
        assertEquals(reason, n.reason());
        return n;
    }

    @Test
    void openCarriesTheObservation() {
        StageObservation.Open o = assertInstanceOf(StageObservation.Open.class, classify(new StageRead.Ok(view())));
        assertEquals("paula", o.employeeId());
        assertEquals(new StageObservation.Order("slot-1", "ren-1", "validated"), o.order());
        assertEquals("2026-11-05T09:00:00.000Z", o.observation().stageAt());
        assertEquals("ORD-1", o.observation().providerReference());
        assertEquals(3, o.observation().lifecycleRevision());
        assertEquals("gcsp-policy-v1", o.observation().stagePolicyVersion());
    }

    @Test
    void topLevelPolicyVersionIsAccepted() {
        ObjectNode v = view();
        v.remove("policy");
        v.put("policyVersion", "gcsp-policy-v1");
        assertInstanceOf(StageObservation.Open.class, classify(new StageRead.Ok(v)));
    }

    @Test
    void notReachedAndNotInLifecycle() {
        StageObservation.NotOpen n = notOpen(v -> ((ObjectNode) v.get("stages").get(0)).put("state", "pending"),
                "opening-stage-not-reached");
        assertEquals("paula", n.employeeId());
        assertEquals("pending", n.stageState());
        notOpen(v -> ((ObjectNode) v.get("stages").get(0)).put("at", "soon"), "opening-stage-not-reached");
        StageObservation.NotOpen m = notOpen(v -> ((ObjectNode) v.get("stages").get(0)).put("stage", "other"),
                "opening-stage-not-in-lifecycle");
        assertEquals(3L, m.lifecycleRevision());
        notOpen(v -> v.remove("stages"), "stage-read-unavailable");
    }

    @Test
    void identityAndContractMismatches() {
        assertNull(notOpen(v -> v.put("orderUuid", "someone-else"), "stage-identity-mismatch").employeeId());
        notOpen(v -> v.put("runId", "run-2"), "stage-identity-mismatch");
        notOpen(v -> v.remove("employeeId"), "stage-identity-mismatch");
        notOpen(v -> v.put("contractVersion", "lifecycle.stages.v2"), "stage-contract-unsupported");
        notOpen(v -> v.remove("lifecycleRevision"), "stage-revision-missing");
        notOpen(v -> v.put("lifecycleRevision", 0), "stage-revision-missing");
        notOpen(v -> v.remove("policy"), "stage-revision-missing");
    }

    @Test
    void renewalAuthorityRule() {
        assertEquals("paula", notOpen(v -> v.remove("renewalId"), "stage-renewal-authority-invalid").employeeId());
        notOpen(v -> v.remove("entitlementSlotId"), "stage-renewal-authority-invalid");
        notOpen(v -> v.put("renewalAuthority", "guessed"), "stage-renewal-authority-invalid");
        notOpen(v -> v.put("renewalAuthority", "missing"), "stage-renewal-authority-invalid");
        ObjectNode missing = view();
        missing.put("renewalAuthority", "missing").remove("renewalId");
        StageObservation.Open o = assertInstanceOf(StageObservation.Open.class, classify(new StageRead.Ok(missing)));
        assertEquals("missing", o.order().renewalAuthority());
        missing.remove("entitlementSlotId");
        assertInstanceOf(StageObservation.Open.class, classify(new StageRead.Ok(missing)));
    }

    @Test
    void nonOkReads() {
        assertEquals("no-lifecycle-for-order",
                assertInstanceOf(StageObservation.NotOpen.class, classify(new StageRead.NotFound())).reason());
        assertEquals("stage-mode-unsupported",
                assertInstanceOf(StageObservation.NotOpen.class, classify(new StageRead.Unsupported())).reason());
        assertEquals("stage-read-forbidden",
                assertInstanceOf(StageObservation.Forbidden.class, classify(new StageRead.Forbidden())).reason());
        StageObservation.NotOpen u = assertInstanceOf(StageObservation.NotOpen.class,
                classify(new StageRead.Unavailable("unavailable", "down")));
        assertEquals("stage-read-unavailable", u.reason());
        assertEquals("unavailable", u.producerStatus());
        assertEquals("down", u.producerCode());
        assertEquals("stage-read-unavailable",
                assertInstanceOf(StageObservation.NotOpen.class, classify(null)).reason());
        assertEquals("stage-read-unavailable",
                assertInstanceOf(StageObservation.NotOpen.class, classify(new StageRead.Ok(JSON.createArrayNode()))).reason());
    }
}
