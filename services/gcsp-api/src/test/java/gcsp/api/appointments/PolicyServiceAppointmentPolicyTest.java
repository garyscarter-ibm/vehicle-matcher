package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.PolicySource;
import gcsp.api.policy.RetainedFilePolicySource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

/** The appointment rules read through the canonical PolicyService match the retained file; no gap is defaulted. */
class PolicyServiceAppointmentPolicyTest {

    static final String V = "gcsp-policy-v1";
    static final Instant T0 = Instant.parse("2026-11-05T09:00:00.000Z");
    static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");

    private static PolicyServiceAppointmentPolicy adapter() {
        return new PolicyServiceAppointmentPolicy(new PolicyService(new RetainedFilePolicySource()));
    }

    private static PolicyServiceAppointmentPolicy edited(Consumer<ObjectNode> edit, Path dir) throws Exception {
        ObjectNode doc = (ObjectNode) ApptFixture.JSON.readTree(Files.readString(SEED));
        edit.accept(doc);
        Path file = dir.resolve("seed.json");
        Files.writeString(file, doc.toString());
        PolicySource source = new RetainedFilePolicySource(file, List.of());
        return new PolicyServiceAppointmentPolicy(new PolicyService(source));
    }

    @Test
    void theSeedGivesTheSameConfigAsTheRetainedFile() throws Exception {
        PolicyResult<AppointmentConfig> viaService = adapter().config("run-1", V, T0);
        PolicyResult<AppointmentConfig> viaFile = new RetainedFileAppointmentPolicy(SEED).config("run-1", V, T0);
        assertEquals(((PolicyResult.Ok<AppointmentConfig>) viaFile).value(),
                assertInstanceOf(PolicyResult.Ok.class, viaService).value());
        PolicyResult<OutcomeTiming> t = adapter().timing("run-1", V, T0);
        assertEquals(((PolicyResult.Ok<OutcomeTiming>) new RetainedFileAppointmentPolicy(SEED).timing("run-1", V, T0)).value(),
                assertInstanceOf(PolicyResult.Ok.class, t).value());
    }

    @Test
    void aWrongPinABlankRunOrAMissingInstantIsUnavailable() {
        for (PolicyResult<AppointmentConfig> r : List.of(adapter().config("run-1", "gcsp-policy-v9", T0),
                adapter().config("run-1", null, T0), adapter().config("", V, T0), adapter().config(null, V, T0),
                adapter().config("run-1", V, null))) {
            PolicyResult.Unavailable<AppointmentConfig> u = assertInstanceOf(PolicyResult.Unavailable.class, r);
            assertEquals("appointment-policy-unavailable", u.code());
            assertTrue(u.retryable());
        }
        assertInstanceOf(PolicyResult.Unavailable.class, adapter().timing("run-1", "gcsp-policy-v9", T0));
    }

    @Test
    void aMissingOrInvalidRowIsUnavailableNeverDefaulted() throws Exception {
        Path dir = Files.createTempDirectory("appt-policy-");
        try {
            assertInstanceOf(PolicyResult.Ok.class, edited(d -> {}, dir).config("run-1", V, T0));
            for (String key : new String[] {AppointmentRules.SLOTS, AppointmentRules.CONFIRMATION, AppointmentRules.SCENARIO,
                    AppointmentRules.OWNERSHIP, AppointmentRules.OUTCOMES}) {
                PolicyServiceAppointmentPolicy p = edited(d -> remove(d, key), dir);
                assertInstanceOf(PolicyResult.Unavailable.class, p.config("run-1", V, T0), key);
            }
            assertInstanceOf(PolicyResult.Unavailable.class,
                    edited(d -> remove(d, AppointmentRules.OUTCOME_TIMING), dir).timing("run-1", V, T0));
            assertInstanceOf(PolicyResult.Unavailable.class, edited(d -> {
                for (JsonNode r : d.get("assumptions")) {
                    if (AppointmentRules.SLOTS.equals(r.get("key").asText())) ((ObjectNode) r.get("value")).put("daysOffered", 99);
                }
            }, dir).config("run-1", V, T0));
        } finally {
            Files.deleteIfExists(dir.resolve("seed.json"));
            Files.deleteIfExists(dir);
        }
    }

    private static void remove(ObjectNode doc, String key) {
        ArrayNode kept = doc.putArray("assumptions");
        try {
            for (JsonNode r : ApptFixture.JSON.readTree(Files.readString(SEED)).get("assumptions")) {
                if (!key.equals(r.get("key").asText())) kept.add(r);
            }
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
