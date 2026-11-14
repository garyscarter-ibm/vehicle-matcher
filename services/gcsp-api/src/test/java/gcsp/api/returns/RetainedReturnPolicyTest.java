package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RetainedReturnPolicyTest {

    static final Instant T0 = ReturnsFixture.T0;
    static final String V = ReturnsFixture.POLICY_VERSION;

    @TempDir Path dir;

    ReturnPolicyReading read(Consumer<ObjectNode> edit) throws Exception {
        return ReturnsFixture.policyFile(dir, edit).read("run-1", T0, V);
    }

    ReturnPolicy ok(ReturnPolicyReading r) {
        return assertInstanceOf(ReturnPolicyReading.Ok.class, r).policy();
    }

    void assertUnavailable(ReturnPolicyReading r) {
        ReturnPolicyReading.Unavailable u = assertInstanceOf(ReturnPolicyReading.Unavailable.class, r);
        assertEquals("return-policy-unavailable", u.code());
        assertTrue(u.retryable());
    }

    @Test
    void readsEveryKeyedValueOfTheSeedRows() throws Exception {
        ReturnPolicy p = ok(read(d -> {}));
        assertEquals(V, p.policyVersion());
        assertEquals(List.of("same-visit", "separate"), p.choices().stream().map(ReturnPolicy.Choice::id).toList());
        ReturnPolicy.Rule separate = p.rules().get("separate");
        assertEquals(List.of("scheduled", "completed"), separate.requiresHandoverStates());
        assertEquals(7, separate.maxDaysAfterHandover());
        assertTrue(separate.notBeforeHandoverEnd());
        assertEquals(new SlotPolicy(2, 10, 60, List.of("09:00", "13:00")), separate.slots());
        assertEquals("handover-slot", p.rules().get("same-visit").slot());
        assertEquals(new SlotPolicy(2, 3, 60, List.of("09:00", "13:00")), p.slotPolicy());
        assertEquals("sent to ordering", p.openingStage());
        assertEquals(1800, p.confirmDelaySeconds());
        assertEquals(2000, p.providerTimeoutMs());
        assertFalse(p.scenario().proposeChange());
        assertEquals("The retailer proposed a different time.", p.scenario().proposalReason());
        assertEquals("employee", p.ownership().states().get("not-requested").owner());
        assertEquals("scheme-team", p.ownership().blocked().owner());
        assertFalse(p.outcome().enabled());
        assertEquals("returned", p.outcome().outcome());
        assertEquals("return-missed", p.outcome().exceptionType());
        assertEquals(6, p.assumptions().size());
        assertTrue(p.assumptions().stream().allMatch(a -> V.equals(a.policyVersion()) && "assumed".equals(a.status())));
        assertTrue(p.assumptions().stream().anyMatch(a -> RetainedReturnPolicy.OWNERSHIP.equals(a.key())));
    }

    @Test
    void theOutcomeScenarioVariantReadsEnabled() throws Exception {
        for (String outcome : new String[] {"returned", "missed"}) {
            ReturnPolicy p = ok(ReturnsFixture.policyFile(dir, d -> {
                ReturnsFixture.row(d, RetainedReturnPolicy.OUTCOME).with("value").put("enabled", true).put("outcome", outcome);
            }).read("run-1", T0, V));
            assertTrue(p.outcome().enabled());
            assertEquals(outcome, p.outcome().outcome());
        }
    }

    @Test
    void aReadIsPinnedToExactlyTheRequestedVersion() throws Exception {
        assertUnavailable(ReturnsFixture.policyFile(dir, d -> {}).read("run-1", T0, "other-version"));
        assertUnavailable(ReturnsFixture.policyFile(dir, d -> {}).read("run-1", T0, null));
        assertUnavailable(read(d -> d.put("policyVersion", "other-version")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.OPTIONS).put("policyVersion", "other-version")));
    }

    @Test
    void aMissingKeyIsUnavailable() throws Exception {
        for (String key : new String[] {RetainedReturnPolicy.OPTIONS, RetainedReturnPolicy.OWNERSHIP, RetainedReturnPolicy.OUTCOME,
                RetainedReturnPolicy.SLOTS, RetainedReturnPolicy.CONFIRMATION, RetainedReturnPolicy.SCENARIO}) {
            assertUnavailable(read(d -> {
                ArrayNode kept = ReturnJson.JSON.createArrayNode();
                for (var r : d.get("assumptions")) if (!key.equals(r.get("key").asText())) kept.add(r);
                d.set("assumptions", kept);
            }));
        }
    }

    @Test
    void aBadRuleOrValueIsUnavailable() throws Exception {
        String o = RetainedReturnPolicy.OPTIONS;
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").with("rules").with("same-visit").put("slot", "after-handover")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").with("rules").with("same-visit").put("location", "home")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").with("rules").with("same-visit").putArray("requiresHandoverStates").add("bogus")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").with("rules").with("separate").put("maxDaysAfterHandover", 61)));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").with("rules").with("separate").with("slots").put("slotMinutes", 4)));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").with("rules").with("separate").with("slots")
                .putArray("dailyStartTimes").add("09:00").add("09:00")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").with("rules").with("separate").with("slots")
                .putArray("dailyStartTimes").add("25:00")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").with("rules").remove("separate")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").withArray("choices").addObject().put("id", "separate").put("label", "again")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).with("value").withArray("choices").removeAll()));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).put("basis", "")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).put("status", "guessed")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, o).put("unit", " ")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.SLOTS).with("value").put("openingState", "draft")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.SLOTS).with("value").put("daysOffered", 15)));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.CONFIRMATION).with("value").put("providerTimeoutMs", 0)));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.CONFIRMATION).with("value").put("confirmDelaySeconds", -1)));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.SCENARIO).with("value").put("proposedSlot", "any")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.SCENARIO).with("value").put("proposeChange", "yes")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.OWNERSHIP).with("value").with("states").remove("scheduled")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.OWNERSHIP).with("value").with("blocked").put("owner", "bot")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.OWNERSHIP).with("value").with("pending").put("nextStep", "Wait — please")));
    }

    @Test
    void theOutcomeKeyIsValidatedEvenWhenTheScenarioIsOff() throws Exception {
        String k = RetainedReturnPolicy.OUTCOME;
        assertUnavailable(read(d -> ReturnsFixture.row(d, k).with("value").put("outcome", "lost")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, k).with("value").put("enabled", "no")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, k).with("value").put("delaySecondsAfterSlotEnd", -5)));
        assertUnavailable(read(d -> ReturnsFixture.row(d, k).with("value").put("exceptionType", "")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, k).with("value").with("ownership").with("missed").put("owner", "nobody")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, k).with("value").with("ownership").remove("returned")));
    }

    @Test
    void effectiveDatesAreHonoured() throws Exception {
        assertUnavailable(read(d -> d.put("effectiveFrom", "2026-11-06T00:00:00.000Z")));
        assertUnavailable(read(d -> d.put("effectiveFrom", "not a date")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.SLOTS).put("effectiveFrom", "2026-11-06T00:00:00.000Z")));
        assertUnavailable(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.SLOTS).put("effectiveTo", "2026-11-05T09:00:00.000Z")));
        ok(read(d -> ReturnsFixture.row(d, RetainedReturnPolicy.SLOTS).put("effectiveTo", "2026-11-05T09:00:01.000Z")));
    }

    @Test
    void anUnreadableOrNonJsonFileIsUnavailable() throws Exception {
        assertUnavailable(new RetainedReturnPolicy(dir.resolve("missing.json")).read("run-1", T0, V));
        Path bad = Files.writeString(dir.resolve("bad.json"), "not json");
        assertUnavailable(new RetainedReturnPolicy(bad).read("run-1", T0, V));
        assertUnavailable(new UnconfiguredReturnPolicy().read("run-1", T0, V));
    }
}
