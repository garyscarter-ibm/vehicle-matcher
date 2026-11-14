package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AppointmentPolicyTest {

    static final Instant T0 = Instant.parse("2026-11-05T09:00:00Z");
    static final String V = "gcsp-policy-v1";

    @TempDir Path dir;

    AppointmentPolicy policy(Consumer<ObjectNode> edit) throws Exception {
        ObjectNode doc = (ObjectNode) ApptFixture.resource("policy.json").deepCopy();
        edit.accept(doc);
        Path file = dir.resolve("policy.json");
        Files.writeString(file, doc.toString());
        return new RetainedFileAppointmentPolicy(file);
    }

    ObjectNode row(ObjectNode doc, String key) {
        for (JsonNode r : doc.get("assumptions")) if (key.equals(r.get("key").asText())) return (ObjectNode) r;
        throw new IllegalStateException(key);
    }

    ObjectNode value(ObjectNode doc, String key) {
        return (ObjectNode) row(doc, key).get("value");
    }

    void unavailable(Consumer<ObjectNode> edit, String why) throws Exception {
        PolicyResult<AppointmentConfig> r = policy(edit).config("run-1", V, T0);
        PolicyResult.Unavailable<AppointmentConfig> u = assertInstanceOf(PolicyResult.Unavailable.class, r, why);
        assertEquals("appointment-policy-unavailable", u.code(), why);
        assertTrue(u.retryable(), why);
        assertEquals("Appointment rules are unavailable. Ask the scheme team to check the scheme setup.", u.reason(), why);
    }

    @Test
    void happyPathReadsEveryRule() throws Exception {
        AppointmentConfig c = ((PolicyResult.Ok<AppointmentConfig>) policy(d -> {}).config("run-1", V, T0)).value();
        assertEquals(V, c.policyVersion());
        assertEquals("sent to ordering", c.openingStage());
        assertEquals("approved", c.openingState());
        assertEquals(new SlotPolicy(2, 3, 60, List.of("09:00", "13:00")), c.slotPolicy());
        assertEquals(1800, c.confirmDelaySeconds());
        assertEquals(2000, c.providerTimeoutMs());
        assertFalse(c.scenario().proposeChange());
        assertEquals("next-offered", c.scenario().proposedSlot());
        assertEquals("The retailer proposed a different time.", c.scenario().proposalReason());
        assertEquals("employee", c.ownership().states().get("not-requested").owner());
        assertEquals("Choose a handover slot.", c.ownership().states().get("not-requested").nextStep());
        assertEquals("retailer", c.ownership().states().get("scheduled").owner());
        assertEquals("scheme-team", c.ownership().ineligible().owner());
        assertEquals("scheme-team", c.ownership().pending().owner());
        assertEquals("scheme-team", c.ownership().blocked().owner());
        assertEquals("Your handover is complete.", c.outcomes().states().get("completed").nextStep());
        assertEquals("employee", c.outcomes().states().get("no-show").owner());
        assertEquals("retailer", c.outcomes().notReady().owner());
        assertEquals(5, c.assumptions().size());
        assertEquals("lifecycle.appointments.slots.v1", c.assumptions().get(0).key());
        assertEquals("assumed", c.assumptions().get(0).status());
        assertEquals(V, c.assumptions().get(0).policyVersion());
        assertEquals("2026-11-07", c.assumptions().get(0).sourceDate());
    }

    @Test
    void outcomeTimingIsRead() throws Exception {
        OutcomeTiming t = ((PolicyResult.Ok<OutcomeTiming>) policy(d -> {}).timing("run-1", V, T0)).value();
        assertEquals(0, t.completeAfterSlotStartSeconds());
        assertEquals(0, t.noShowAfterSlotStartSeconds());
        assertEquals("retailer", t.tooEarly().owner());
        assertInstanceOf(PolicyResult.Unavailable.class,
                policy(d -> value(d, "lifecycle.appointments.outcomeTiming.v1").put("completeAfterSlotStartSeconds", 86401))
                        .timing("run-1", V, T0));
        assertInstanceOf(PolicyResult.Unavailable.class, policy(d -> value(d, "lifecycle.appointments.outcomeTiming.v1")
                .with("tooEarly").put("owner", "nobody")).timing("run-1", V, T0));
        assertInstanceOf(PolicyResult.Unavailable.class, policy(d -> value(d, "lifecycle.appointments.outcomeTiming.v1")
                .with("tooEarly").put("nextStep", "Wait — please")).timing("run-1", V, T0));
        assertInstanceOf(PolicyResult.Unavailable.class, policy(d -> value(d, "lifecycle.appointments.outcomeTiming.v1")
                .remove("tooEarly")).timing("run-1", V, T0));
    }

    @Test
    void everyMissingKeyIsUnavailable() throws Exception {
        JsonNode original = ApptFixture.resource("policy.json");
        for (String key : new String[] {AppointmentRules.SLOTS, AppointmentRules.CONFIRMATION,
                AppointmentRules.SCENARIO, AppointmentRules.OWNERSHIP,
                AppointmentRules.OUTCOMES}) {
            unavailable(d -> {
                ArrayNode kept = d.putArray("assumptions");
                for (JsonNode r : original.get("assumptions")) if (!key.equals(r.get("key").asText())) kept.add(r);
            }, key);
            unavailable(d -> row(d, key).put("policyVersion", "other"), key + " version");
            unavailable(d -> row(d, key).put("status", "guess"), key + " status");
            unavailable(d -> row(d, key).put("unit", " "), key + " unit");
            unavailable(d -> row(d, key).put("basis", "Plausible — revisable"), key + " em dash");
        }
    }

    @Test
    void wrongPinnedVersionOrFileVersionIsUnavailable() throws Exception {
        assertInstanceOf(PolicyResult.Unavailable.class, policy(d -> {}).config("run-1", "gcsp-policy-v2", T0));
        assertInstanceOf(PolicyResult.Unavailable.class, policy(d -> d.put("policyVersion", "gcsp-policy-v2")).config("run-1", V, T0));
        assertInstanceOf(PolicyResult.Unavailable.class, policy(d -> {}).config("run-1", null, T0));
    }

    @Test
    void notYetOrNoLongerEffectiveIsUnavailable() throws Exception {
        unavailable(d -> d.put("effectiveFrom", "2026-11-06T00:00:00.000Z"), "file not yet effective");
        unavailable(d -> row(d, AppointmentRules.SLOTS).put("effectiveFrom", "2026-11-06T00:00:00.000Z"),
                "row not yet effective");
        unavailable(d -> row(d, AppointmentRules.SLOTS).put("effectiveTo", "2026-11-05T09:00:00.000Z"),
                "row ended");
        unavailable(d -> row(d, AppointmentRules.SLOTS).put("effectiveFrom", "garbage"), "bad row date");
        assertInstanceOf(PolicyResult.Ok.class, policy(d -> row(d, AppointmentRules.SLOTS)
                .put("effectiveTo", "2026-11-05T09:00:00.001Z")).config("run-1", V, T0));
    }

    @Test
    void badSlotRulesAreUnavailable() throws Exception {
        String k = AppointmentRules.SLOTS;
        unavailable(d -> value(d, k).put("openingState", "pending"), "opening state");
        unavailable(d -> value(d, k).put("openingStage", ""), "opening stage");
        unavailable(d -> value(d, k).put("earliestLeadDays", 61), "lead high");
        unavailable(d -> value(d, k).put("earliestLeadDays", -1), "lead low");
        unavailable(d -> value(d, k).put("daysOffered", 0), "days low");
        unavailable(d -> value(d, k).put("daysOffered", 15), "days high");
        unavailable(d -> value(d, k).put("slotMinutes", 4), "minutes low");
        unavailable(d -> value(d, k).put("slotMinutes", 481), "minutes high");
        unavailable(d -> value(d, k).put("slotMinutes", 60.5), "minutes fraction");
        unavailable(d -> value(d, k).putArray("dailyStartTimes"), "no times");
        unavailable(d -> value(d, k).putArray("dailyStartTimes").add("9:00"), "bad time");
        unavailable(d -> value(d, k).putArray("dailyStartTimes").add("24:00"), "hour 24");
        unavailable(d -> value(d, k).putArray("dailyStartTimes").add("09:00").add("09:00"), "duplicate times");
        unavailable(d -> value(d, k).remove("dailyStartTimes"), "times missing");
    }

    @Test
    void badConfirmationScenarioAndOwnershipAreUnavailable() throws Exception {
        String conf = AppointmentRules.CONFIRMATION;
        unavailable(d -> value(d, conf).put("confirmDelaySeconds", -1), "delay low");
        unavailable(d -> value(d, conf).put("confirmDelaySeconds", 30 * 86400 + 1), "delay high");
        unavailable(d -> value(d, conf).put("providerTimeoutMs", 0), "timeout low");
        unavailable(d -> value(d, conf).put("providerTimeoutMs", 60001), "timeout high");
        String sc = AppointmentRules.SCENARIO;
        unavailable(d -> value(d, sc).put("proposeChange", "no"), "propose not boolean");
        unavailable(d -> value(d, sc).put("proposedSlot", "same"), "proposed slot rule");
        unavailable(d -> value(d, sc).put("proposalReason", "Another time — sorry"), "reason em dash");
        String own = AppointmentRules.OWNERSHIP;
        unavailable(d -> value(d, own).with("states").with("requested").put("owner", "nobody"), "bad owner");
        unavailable(d -> value(d, own).with("states").with("requested").put("nextStep", "Wait — soon"), "step em dash");
        unavailable(d -> value(d, own).with("states").with("scheduled").put("nextStep", ""), "blank step");
        unavailable(d -> value(d, own).with("states").remove("change-proposed"), "missing state");
        unavailable(d -> value(d, own).remove("blocked"), "missing blocked");
        unavailable(d -> value(d, own).remove("pending"), "missing pending");
        unavailable(d -> value(d, own).remove("ineligible"), "missing ineligible");
    }

    @Test
    void outcomesRulesAreRequired() throws Exception {
        String k = AppointmentRules.OUTCOMES;
        unavailable(d -> value(d, k).remove("notReady"), "missing notReady");
        unavailable(d -> value(d, k).with("notReady").put("owner", "nobody"), "bad notReady owner");
        unavailable(d -> value(d, k).with("states").remove("no-show"), "missing no-show");
        unavailable(d -> value(d, k).with("states").remove("completed"), "missing completed");
        unavailable(d -> value(d, k).remove("exceptionTypes"), "missing exceptionTypes");
        unavailable(d -> value(d, k).with("exceptionTypes").put("noShow", ""), "blank noShow type");
    }

    @Test
    void unreadableOrUnconfiguredIsUnavailable() throws Exception {
        assertInstanceOf(PolicyResult.Unavailable.class, new RetainedFileAppointmentPolicy(dir.resolve("absent.json")).config("run-1", V, T0));
        Path junk = dir.resolve("junk.json");
        Files.writeString(junk, "{not json");
        assertInstanceOf(PolicyResult.Unavailable.class, new RetainedFileAppointmentPolicy(junk).config("run-1", V, T0));
        assertInstanceOf(PolicyResult.Unavailable.class, new RetainedFileAppointmentPolicy(junk).timing("run-1", V, T0));
        assertInstanceOf(PolicyResult.Unavailable.class, new UnconfiguredAppointmentPolicy().config("run-1", V, T0));
        assertInstanceOf(PolicyResult.Unavailable.class, new UnconfiguredAppointmentPolicy().timing("run-1", V, T0));
    }

    @Test
    void repeatedKeyIsUnavailable() throws Exception {
        unavailable(d -> ((ArrayNode) d.get("assumptions")).add(row(d, AppointmentRules.SLOTS).deepCopy()),
                "duplicate row");
    }
}
