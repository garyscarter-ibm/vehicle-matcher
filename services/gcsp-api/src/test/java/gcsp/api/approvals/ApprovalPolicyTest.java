package gcsp.api.approvals;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

/** Validation of the four lifecycle entries and the retained-file reader (no database needed). */
class ApprovalPolicyTest {

    private static final String V = ApprovalFixture.VERSION;
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");

    private static ApprovalPolicy.Loaded load(String key, Consumer<ObjectNode> edit, List<String> snapshot) {
        ApprovalFixture.Policy p = new ApprovalFixture.Policy();
        if (key != null) p.edit(key, edit);
        return ApprovalPolicy.load(p, V, snapshot);
    }

    private static ObjectNode value(ObjectNode entry) {
        return (ObjectNode) entry.get("value");
    }

    @Test
    void theRetainedSeedLoadsWithProvenance() {
        ApprovalPolicy.Policy p = ((ApprovalPolicy.Ok) load(null, null, null)).policy();
        assertEquals(List.of("selection received", "HR approval", "sales-manager approval", "sent to ordering"), p.stageList());
        assertEquals(2, p.ticks().get("HR approval"));
        assertEquals(4, p.provenance().size());
        assertEquals("ordering.approvalStages.v1", p.provenance().get(0).get("key").asText());
        assertEquals("HR", p.stageOwners().get("HR approval").owner());
    }

    @Test
    void thePinnedSnapshotGovernsAndMustItselfBeAllowed() {
        ApprovalPolicy.Policy p = ((ApprovalPolicy.Ok) load(null, null, ApprovalFixture.SHORT)).policy();
        assertEquals(List.of("selection received", "sales-manager approval", "sent to ordering"), p.stageList());
        assertEquals(new ApprovalPolicy.OrderScoped(ApprovalPolicy.INVALID),
                load(null, null, List.of("sales-manager approval", "HR approval", "sent to ordering")));
    }

    @Test
    void invalidEntriesAreOrderScopedInvalid() {
        String ticks = ApprovalPolicy.TICKS_KEY;
        String own = ApprovalPolicy.OWNERSHIP_KEY;
        String decline = ApprovalPolicy.DECLINE_KEY;
        for (int bad : new int[] {0, 51, -1}) {
            assertInvalid(ticks, e -> value(e).put("HR approval", bad));
        }
        assertInvalid(ticks, e -> value(e).put("HR approval", 1.5));
        assertInvalid(ticks, e -> value(e).remove("sales-manager approval"));
        assertInvalid(own, e -> ((ObjectNode) value(e).get("stages").get("HR approval")).put("owner", "the boss"));
        assertInvalid(own, e -> ((ObjectNode) value(e).get("stages").get("HR approval")).put("nextStep", "HR — decision"));
        assertInvalid(own, e -> ((ObjectNode) value(e).get("outcomes")).remove("declined"));
        assertInvalid(decline, e -> value(e).put("reasonCode", "x".repeat(65)));
        assertInvalid(decline, e -> value(e).put("reason", "The manager — declined."));
        assertInvalid(decline, e -> value(e).put("enabled", true).put("stage", "HR clearance"));
        assertInvalid(decline, e -> value(e).put("eventType", " "));
        assertInvalid(ApprovalPolicy.STAGE_LIST_KEY, e -> ((ObjectNode) e).putArray("value").add("sent to ordering"));
        assertInvalid(ApprovalPolicy.STAGE_LIST_KEY, e -> ((ObjectNode) e).putArray("value")
                .add("sales-manager approval").add("HR approval").add("sent to ordering"));
    }

    @Test
    void entryMetadataProblemsAreOrderScopedUnavailable() {
        String ticks = ApprovalPolicy.TICKS_KEY;
        assertEquals(new ApprovalPolicy.OrderScoped(ApprovalPolicy.UNAVAILABLE), load(ticks, e -> e.put("status", "guess"), null));
        assertEquals(new ApprovalPolicy.OrderScoped(ApprovalPolicy.UNAVAILABLE), load(ticks, e -> e.put("policyVersion", "other"), null));
        assertEquals(new ApprovalPolicy.OrderScoped(ApprovalPolicy.UNAVAILABLE), load(ticks, e -> e.put("basis", "b".repeat(2001)), null));
        assertEquals(new ApprovalPolicy.OrderScoped(ApprovalPolicy.UNAVAILABLE), load(ticks, e -> e.put("unit", ""), null));
    }

    @Test
    void sourceOutcomesMapToScopes() {
        assertEquals(new ApprovalPolicy.PolicyWide(ApprovalPolicy.UNAVAILABLE), ApprovalPolicy.load(null, V, null));
        assertEquals(new ApprovalPolicy.OrderScoped(ApprovalPolicy.UNAVAILABLE),
                ApprovalPolicy.load((v, k) -> new ApprovalPolicyPort.VersionNotFound(), V, null));
        assertEquals(new ApprovalPolicy.OrderScoped(ApprovalPolicy.UNAVAILABLE),
                ApprovalPolicy.load((v, k) -> new ApprovalPolicyPort.Found(V, java.util.Map.of()), V, null));
        assertEquals(new ApprovalPolicy.PolicyWide("policy-source-invalid"),
                ApprovalPolicy.load((v, k) -> new ApprovalPolicyPort.Unavailable("policy-source-invalid"), V, null));
        assertEquals(new ApprovalPolicy.PolicyWide("policy-source-unavailable"), ApprovalPolicy.load((v, k) -> null, V, null));
    }

    @Test
    void theRetainedFileReaderReadsTheNodeSeedAndRefusesBadFiles(@org.junit.jupiter.api.io.TempDir Path dir) throws Exception {
        RetainedApprovalPolicy retained = new RetainedApprovalPolicy(SEED);
        ApprovalPolicyPort.Found found = assertInstanceOf(ApprovalPolicyPort.Found.class,
                retained.entries(V, ApprovalPolicy.KEYS));
        assertEquals(4, found.entries().size());
        assertTrue(found.entries().containsKey("lifecycle.approval.ownership.v1"));
        assertInstanceOf(ApprovalPolicy.Ok.class, ApprovalPolicy.load(retained, V, null));
        assertInstanceOf(ApprovalPolicyPort.VersionNotFound.class, retained.entries("gcsp-policy-v0", ApprovalPolicy.KEYS));
        assertEquals("policy-source-unavailable", assertInstanceOf(ApprovalPolicyPort.Unavailable.class,
                new RetainedApprovalPolicy(dir.resolve("missing.json")).entries(V, ApprovalPolicy.KEYS)).code());
        Path broken = dir.resolve("broken.json");
        java.nio.file.Files.writeString(broken, "{ \"schemaVersion\": 1, ");
        assertEquals("policy-source-unavailable", assertInstanceOf(ApprovalPolicyPort.Unavailable.class,
                new RetainedApprovalPolicy(broken).entries(V, ApprovalPolicy.KEYS)).code());
        Path noRows = dir.resolve("norows.json");
        java.nio.file.Files.writeString(noRows, "{\"policyVersion\":\"" + V + "\"}");
        assertEquals("policy-source-invalid", assertInstanceOf(ApprovalPolicyPort.Unavailable.class,
                new RetainedApprovalPolicy(noRows).entries(V, ApprovalPolicy.KEYS)).code());
    }

    private static void assertInvalid(String key, Consumer<ObjectNode> edit) {
        assertEquals(new ApprovalPolicy.OrderScoped(ApprovalPolicy.INVALID), load(key, edit, null), key);
    }
}
