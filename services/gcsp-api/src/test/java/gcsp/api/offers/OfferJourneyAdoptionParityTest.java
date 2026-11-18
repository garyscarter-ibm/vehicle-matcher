package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockResult;
import gcsp.api.clock.RunClock;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunReset;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.policy.PolicyActivation;
import gcsp.api.policy.PolicyAdoption;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyDatabase;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.PolicySource;
import gcsp.api.policy.PostgresPolicySource;
import gcsp.api.policy.RetainedFilePolicySource;
import gcsp.api.policy.ReviewedDefinitions;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/**
 * FUCQ-510 parity: Java's startup adoption of offer-journey-v2 against server/test/gcsp-offer-journey-adoption.test.js.
 * Drives OfferJourneyPolicy.ensure() over a real RunClock and Postgres policy classes, as the app composes them.
 */
class OfferJourneyAdoptionParityTest {

    static final String ENV = OffersPg.ENV;
    static final String BASE = "gcsp-policy-v1";
    static final String V1 = BASE + "+offer-journey-v1";
    static final String V2 = BASE + "+offer-journey-v2";
    static final String V1_V2 = V1 + "+offer-journey-v2";
    static final List<String> KEYS = List.of("offer.declineReasons.v1", "offer.followupQuestions.v1",
            "offer.declinedCar.reentry.v1");
    static final Instant WALL = Instant.parse("2026-11-14T10:00:00Z");
    static final String HEADERS = "SELECT string_agg(policy_version || '|' || to_char(effective_from AT TIME ZONE 'UTC', "
            + "'YYYY-MM-DD\"T\"HH24:MI:SS.MS') || '|' || seed_digest, ';' ORDER BY policy_version) FROM policy_versions";

    /** One process's worth of policy, clock and startup classes over the shared schema. */
    static final class Stack {
        final PolicyService service;
        final RunClock clock;
        final OfferJourneyPolicy startup = new OfferJourneyPolicy();

        Stack(OffersPg pg) throws Exception {
            PGSimpleDataSource pool = pg.pool();
            PolicyDatabase database = new PolicyDatabase(pool, ENV);
            RetainedFilePolicySource file = new RetainedFilePolicySource();
            // The Postgres source constructor is package-private to gcsp.api.policy.
            var ctor = PostgresPolicySource.class.getDeclaredConstructor(PolicyDatabase.class, RetainedFilePolicySource.class);
            ctor.setAccessible(true);
            PolicySource source = ctor.newInstance(database, file);
            service = new PolicyService(source);
            clock = new RunClock(pool, new TransactionRunner(pool), new PolicyService(file), List.of(),
                    InstantSource.fixed(WALL));
            PolicyClock policyClock = ctx -> now(ctx.runId());
            PolicyAdoption adoption = new PolicyAdoption(source, file, database, new PolicyActivation(service, database,
                    policyClock));
            startup.persistence = new Persistence() {
                @Override
                public boolean active() {
                    return true;
                }
            };
            startup.adoption = adoption;
            startup.clock = new RunClockHolder() {
                @Override
                public synchronized RunClock clock() {
                    return clock;
                }
            };
            startup.environmentId = Optional.of(ENV);
            startup.runId = Optional.of("run-1");
        }

        Instant now(String runId) {
            return clock.now(ENV, runId).map(ClockReading::now).orElse(WALL);
        }

        String ensure(String version) {
            startup.policyVersion = Optional.of(version);
            return startup.ensure();
        }

        PolicyResult read(String runId, String key, String pin) {
            return service.getAssumption(key, new PolicyRead(runId, PolicyClock.iso(now(runId).plusSeconds(60)), pin));
        }

        String active(String runId) {
            PolicyResult r = service.getActiveVersion(new PolicyRead(runId, PolicyClock.iso(now(runId).plusSeconds(60)), null));
            return r.ok() ? r.policyVersion() : "none:" + r.code();
        }
    }

    OffersPg pg;
    Stack stack;

    @BeforeEach
    void setUp() throws Exception {
        pg = OffersPg.create();
        stack = new Stack(pg);
        ClockResult started = stack.clock.initialize(ENV, "run-1");
        assertTrue(started.ok(), started.toString());
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (pg != null) pg.close();
    }

    private long count(String sql) throws SQLException {
        return Long.parseLong(text(sql));
    }

    private String text(String sql) throws SQLException {
        try (Connection c = pg.pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql);
                ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getString(1);
        }
    }

    private void assertReviewedKeys(String runId, String version, String definitionSetId) throws Exception {
        JsonNode definitions = ReviewedDefinitions.get(definitionSetId).get("definitions");
        assertEquals(KEYS.size(), definitions.size());
        for (int i = 0; i < KEYS.size(); i++) {
            JsonNode want = definitions.get(i);
            assertEquals(KEYS.get(i), want.get("key").textValue());
            PolicyResult got = stack.read(runId, KEYS.get(i), version);
            assertTrue(got.ok(), KEYS.get(i) + " at " + version + ": " + got.body());
            assertEquals(version, got.policyVersion());
            for (String field : List.of("value", "unit", "basis", "source", "sourceDate", "status")) {
                assertEquals(want.get(field), got.value().get(field), KEYS.get(i) + "." + field);
            }
        }
    }

    @Test
    void adoptedOnStart() throws Exception {
        assertEquals("adopted", stack.ensure(V2));
        assertEquals(V2, stack.active("run-1"));
        assertReviewedKeys("run-1", V2, "offer-journey-v2");
        for (String key : KEYS) {
            assertFalse(stack.read("run-1", key, BASE).ok(), key + " must stay absent from the base version");
        }
    }

    @Test
    void alreadyAdoptedIsANoOp() throws Exception {
        assertEquals("adopted", stack.ensure(V2));
        String before = text(HEADERS);
        long receipts = count("SELECT count(*) FROM command_receipts");
        assertEquals("present", stack.ensure(V2));
        Stack restarted = new Stack(pg);
        assertEquals("present", restarted.ensure(V2));
        assertEquals(V2, restarted.active("run-1"));
        assertEquals(before, text(HEADERS));
        assertEquals(receipts, count("SELECT count(*) FROM command_receipts"));
        assertEquals(2, count("SELECT count(*) FROM policy_versions"));
    }

    // Node's "no Greg principal" has no Java twin (no principal step by design); the closest stop is an unadoptable base.
    @Test
    void noAdoptionPossibleStopsStartup() throws Exception {
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> stack.ensure("other+offer-journey-v2"));
        assertTrue(e.getMessage().contains("not the version in force"), e.getMessage());
        assertEquals(0, count("SELECT count(*) FROM policy_versions WHERE policy_version LIKE '%offer-journey%'"));
        assertFalse(stack.read("run-1", KEYS.get(0), null).ok());
    }

    @Test
    @Disabled("FUCQ-510 parity gap: Java refuses a same-instant v2 upgrade (no 1 ms clock advance, successor must be "
            + "dated later than v1); Russell to decide")
    void sameInstantUpgrade() throws Exception {
        assertEquals("adopted", stack.ensure(V1));
        String retained = text(HEADERS);
        assertEquals("adopted", stack.ensure(V1_V2));
        assertEquals(V1_V2, stack.active("run-1"));
        assertReviewedKeys("run-1", V1_V2, "offer-journey-v2");
        assertTrue(text(HEADERS).startsWith(retained + ";"), "v1 rows unchanged");
    }

    @Test
    @Disabled("FUCQ-510 parity gap: nothing re-adopts after a reset, so the new run stays on the base version; "
            + "Russell to decide")
    void reAdoptionAfterReset() throws Exception {
        assertEquals("adopted", stack.ensure(V2));
        Outcome reset = new RunReset(pg.pool(), text("SELECT current_database()"), ENV).reset(ENV, "presenter",
                "reset-1", "run-1", "run-2");
        assertTrue(reset instanceof Outcome.Committed, reset.toString());
        assertTrue(stack.clock.initialize(ENV, "run-2").ok());
        assertEquals(V2, stack.active("run-2"));
        assertReviewedKeys("run-2", V2, "offer-journey-v2");
    }
}
