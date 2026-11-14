package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.policy.PolicyService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** Everything readRecords decides before it touches a table; none of these tests needs a database. */
class LearningRecordServicePureTest {

    private static final LearningOutcomeRows UNBOUND = new UnboundLearningOutcomeRows();
    private static final LearningClock.Reading GOOD = new LearningClock.Reading(LearningDb.NOW, "clock-v1");

    private static LearningRecordService service(PolicyService policy, LearningClock.Reading reading) {
        return new LearningRecordService(() -> null, policy, context -> reading, UNBOUND);
    }

    private static void refused(LearningRecordResult r, String status, String code) {
        assertFalse(r.ok(), r.body().toString());
        assertEquals(status, r.status());
        assertEquals(code, r.code());
        assertEquals("1.0.0", r.body().get("contractVersion").textValue());
    }

    private static Principal greg(String env, String run, String policy) {
        return new Principal("greg-1", List.of("greg"), env, run, null, policy, List.of());
    }

    @Test
    void onlyGregMayRead() {
        LearningRecordService s = service(LearningDb.policy(LearningDb.reviewedReasons()), GOOD);
        refused(s.readRecords(LearningDb.employee()), "forbidden", "role-required");
        refused(s.readRecords(new Principal("p", List.of("presenter"), "e", "r", null, "v", List.of())), "forbidden", "role-required");
    }

    @Test
    void aPrincipalWithoutRunContextIsNotConfigured() {
        LearningRecordService s = service(LearningDb.policy(LearningDb.reviewedReasons()), GOOD);
        refused(s.readRecords(null), "unavailable", "not-configured");
        refused(s.readRecords(greg(null, "run-1", "gcsp-policy-v1")), "unavailable", "not-configured");
        refused(s.readRecords(greg("env", " ", "gcsp-policy-v1")), "unavailable", "not-configured");
        refused(s.readRecords(greg("env", "run-1", null)), "unavailable", "not-configured");
    }

    @Test
    void anInvalidClockFailsClosed() {
        PolicyService policy = LearningDb.policy(LearningDb.reviewedReasons());
        for (LearningClock.Reading bad : List.of(new LearningClock.Reading("not-a-date", "v"), new LearningClock.Reading(null, "v"),
                new LearningClock.Reading("2026-02-30T00:00:00.000Z", "v"), new LearningClock.Reading(LearningDb.NOW, ""),
                new LearningClock.Reading(LearningDb.NOW, 0), new LearningClock.Reading(LearningDb.NOW, null),
                new LearningClock.Reading(LearningDb.NOW, 1.5), new LearningClock.Reading(null, null))) {
            refused(service(policy, bad).readRecords(LearningDb.greg()), "unavailable", "clock-invalid");
        }
        refused(new LearningRecordService(() -> null, policy, context -> null, UNBOUND).readRecords(LearningDb.greg()),
                "unavailable", "clock-invalid");
    }

    @Test
    void declineReasonsMustBeTheReviewedRegistryAtThePrincipalsVersion() {
        // The seed has no registry, so the default deployment answers unavailable, as Node does.
        refused(service(LearningDb.policy(null), GOOD).readRecords(LearningDb.greg()), "unavailable", "decline-reasons-unavailable");
        PolicyService present = LearningDb.policy(LearningDb.reviewedReasons());
        refused(service(present, GOOD).readRecords(greg("env", "run-1", "gcsp-policy-v9")), "unavailable", "decline-reasons-unavailable");
        ObjectNode duplicate = LearningDb.reviewedReasons();
        duplicate.withArray("reasons").addObject().put("code", "size").put("label", "Again").put("attribute", "sizeClass");
        refused(service(LearningDb.policy(duplicate), GOOD).readRecords(LearningDb.greg()), "unavailable", "decline-reasons-unavailable");
        ObjectNode empty = LearningDb.reviewedReasons();
        empty.withArray("reasons").removeAll();
        refused(service(LearningDb.policy(empty), GOOD).readRecords(LearningDb.greg()), "unavailable", "decline-reasons-unavailable");
        ObjectNode wrongSchema = LearningDb.reviewedReasons();
        wrongSchema.put("schemaVersion", 2);
        refused(service(LearningDb.policy(wrongSchema), GOOD).readRecords(LearningDb.greg()), "unavailable", "decline-reasons-unavailable");
    }

    @Test
    void persistenceOffAndAnUnreachableDatabaseAreDistinct() {
        PolicyService policy = LearningDb.policy(LearningDb.reviewedReasons());
        refused(service(policy, GOOD).readRecords(LearningDb.greg()), "unavailable", "persistence-not-configured");
        PGSimpleDataSource dead = new PGSimpleDataSource();
        dead.setUrl("jdbc:postgresql://127.0.0.1:1/none?connectTimeout=2");
        refused(new LearningRecordService(() -> dead, policy, context -> GOOD, UNBOUND).readRecords(LearningDb.greg()),
                "unavailable", "database-unavailable");
    }

    @Test
    void theDefaultOutcomePortIsUnboundAndEmpty() throws Exception {
        assertFalse(UNBOUND.bound());
        assertSame(LearningOutcomeRows.Rows.EMPTY, UNBOUND.read(null, "e", "r"));
        assertTrue(LearningOutcomeRows.Rows.EMPTY.offers().isEmpty() && LearningOutcomeRows.Rows.EMPTY.receipts().isEmpty());
    }

    @Test
    void theDefaultClockIsTheWallClockAtIsoMillis() {
        LearningClock.Reading r = new WallLearningClock(context -> java.time.Instant.parse("2026-11-13T12:00:00.123456Z"))
                .now(new gcsp.api.persistence.RunContext("e", "r", "a"));
        assertEquals("2026-11-13T12:00:00.123Z", r.now());
        assertEquals("wall-clock", r.clockVersion());
    }
}
