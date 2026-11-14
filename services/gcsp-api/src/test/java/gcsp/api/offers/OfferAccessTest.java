package gcsp.api.offers;

import static gcsp.api.offers.OfferFixtures.NOW;
import static gcsp.api.offers.OfferFixtures.OFFER;
import static gcsp.api.offers.OfferFixtures.employee;
import static gcsp.api.offers.OfferFixtures.record;
import static gcsp.api.offers.OfferFixtures.role;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.offers.OfferRecords.Found;
import gcsp.api.offers.OfferRecords.Listed;
import gcsp.api.offers.OfferRecords.Listing;
import gcsp.api.offers.OfferRecords.Lookup;
import gcsp.api.offers.OfferRecords.Missing;
import gcsp.api.offers.OfferRecords.OfferRecord;
import gcsp.api.offers.OfferRecords.OfferSummary;
import gcsp.api.offers.OfferRecords.StaleRun;
import gcsp.api.offers.OfferRecords.Unavailable;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class OfferAccessTest {

    static final class Fake implements OfferRecords {
        Lookup result = new Missing();
        Listing listing = new Listed(List.of());
        RuntimeException failure;
        final List<RunContext> lookups = new ArrayList<>();

        @Override
        public Lookup find(RunContext ctx, String offerId) {
            lookups.add(ctx);
            if (failure != null) throw failure;
            return result;
        }

        @Override
        public Listing listForEmployee(RunContext ctx, String employeeId) {
            lookups.add(ctx);
            if (failure != null) throw failure;
            return listing;
        }
    }

    private final Fake fake = new Fake();
    private Instant now = NOW;
    private final OfferAccess access = new OfferAccess(fake, (ctx) -> now);

    private OfferOutcome read(String offerId) {
        return access.read(employee("E-1"), offerId);
    }

    @Test
    void ownerReadsAnActiveOffer() {
        fake.result = new Found(OfferFixtures.active("E-1"));
        OfferOutcome o = read(OFFER);
        assertEquals(200, o.http());
        assertEquals("pending", o.value().get("state").asText());
        assertEquals("awaiting-decision", o.value().get("reason").asText());
        assertEquals(2, o.value().get("availableActions").size());
        assertEquals(new RunContext("env-1", "run-1", "sub-E-1"), fake.lookups.get(0));
    }

    @Test
    void anotherEmployeeLearnsNothingAboutTheOffer() {
        fake.result = new Found(OfferFixtures.active("E-2"));
        OfferOutcome o = read(OFFER);
        assertEquals(403, o.http());
        assertEquals("offer-not-owned", o.code());
        assertNull(o.value());
        assertNull(o.current());
        assertFalse(o.reason().contains("—"));
    }

    @Test
    void presenterAndGregAreRefusedBeforeAnyLookup() {
        fake.result = new Found(OfferFixtures.active("E-1"));
        for (String r : List.of("presenter", "greg")) {
            OfferOutcome o = access.read(role(r), OFFER);
            assertEquals(403, o.http());
            assertEquals("role-required", o.code());
            assertEquals(403, access.listCurrent(role(r)).http());
            assertEquals(403, ((OfferAuthority.Refused) access.authorizeDecision(role(r), OFFER, 7)).refusal().http());
        }
        assertTrue(fake.lookups.isEmpty());
    }

    @Test
    void invalidReferencesAreRefusedBeforeLookup() {
        for (String bad : new String[] {"", "x".repeat(129), "a/b", "a b", "a\u0001b", "a?b", null}) {
            OfferOutcome o = read(bad);
            assertEquals(400, o.http());
            assertEquals("invalid-offer-reference", o.code());
        }
        assertTrue(fake.lookups.isEmpty());
        fake.result = new Found(OfferFixtures.active("E-1"));
        assertEquals(200, read("x".repeat(128)).http());
    }

    @Test
    void missingStaleAndUnavailable() {
        assertEquals("offer-not-found", read(OFFER).code());
        assertEquals(404, read(OFFER).http());
        fake.result = new StaleRun();
        OfferOutcome stale = read(OFFER);
        assertEquals(409, stale.http());
        assertEquals("stale-run", stale.status());
        assertEquals("offer-from-earlier-run", stale.code());
        assertNull(stale.current());
        fake.result = new Unavailable();
        OfferOutcome un = read(OFFER);
        assertEquals(503, un.http());
        assertEquals("offer-access-unavailable", un.code());
        assertTrue(un.retryable());
    }

    @Test
    void throwingPortIsUnavailableWithoutLeakingText() {
        fake.failure = new IllegalStateException("jdbc:secret-host exploded");
        OfferOutcome o = read(OFFER);
        assertEquals(503, o.http());
        assertEquals("offer-access-unavailable", o.code());
        assertFalse(o.reason().contains("secret"));
        assertEquals(503, access.listCurrent(employee("E-1")).http());
    }

    @Test
    void terminalOffersReadAsTheirActualState() {
        String[][] rows = {{"accepted", "allocated", "accepted"}, {"declined", "released", "declined"},
                {"superseded", "released", "superseded"}, {"expired", "expired", "expired"},
                {"released", "released", "released"}};
        for (String[] row : rows) {
            fake.result = new Found(record(OFFER, "E-1", row[0], row[1]));
            OfferOutcome o = read(OFFER);
            assertEquals(200, o.http(), row[0]);
            assertEquals(row[2], o.value().get("state").asText());
            assertEquals(0, o.value().get("availableActions").size());
        }
    }

    @Test
    void deadlinePassedReadsAsExpired() {
        OfferRecord r = OfferFixtures.active("E-1");
        fake.result = new Found(r);
        now = r.expiresAt();
        OfferOutcome o = read(OFFER);
        assertEquals(200, o.http());
        assertEquals("expired", o.value().get("state").asText());
    }

    @Test
    void inconsistentStatesAreUnavailableNotGuessed() {
        fake.result = new Found(record(OFFER, "E-1", "active", "released"));
        OfferOutcome o = read(OFFER);
        assertEquals(503, o.http());
        assertEquals("offer-state-inconsistent", o.code());
    }

    @Test
    void unavailableClockIsUnavailable() {
        OfferAccess broken = new OfferAccess(fake, (ctx) -> {
            throw new IllegalStateException("clock");
        });
        fake.result = new Found(OfferFixtures.active("E-1"));
        assertEquals(503, broken.read(employee("E-1"), OFFER).http());
    }

    @Test
    void decisionAuthorizedForTheActiveOwner() {
        fake.result = new Found(OfferFixtures.active("E-1"));
        OfferAuthority a = access.authorizeDecision(employee("E-1"), OFFER, 7);
        OfferAuthority.Authorized ok = assertInstanceOf(OfferAuthority.Authorized.class, a);
        assertEquals("E-1", ok.record().employeeId());
        assertEquals(List.of("accept", "decline"), ok.view().availableActions());
    }

    private OfferOutcome refusal(OfferAuthority a) {
        return assertInstanceOf(OfferAuthority.Refused.class, a).refusal();
    }

    @Test
    void decisionRefusedForStaleVersionWithCurrentState() {
        fake.result = new Found(OfferFixtures.active("E-1"));
        OfferOutcome o = refusal(access.authorizeDecision(employee("E-1"), OFFER, 6));
        assertEquals(409, o.http());
        assertEquals("conflict", o.status());
        assertEquals("stale-version", o.code());
        assertEquals("pending", o.current().get("state").asText());
        assertEquals(7, o.current().get("offerVersion").asLong());
    }

    @Test
    void decisionRefusedWhenTerminalOrPastDeadline() {
        fake.result = new Found(record(OFFER, "E-1", "accepted", "allocated"));
        OfferOutcome o = refusal(access.authorizeDecision(employee("E-1"), OFFER, 7));
        assertEquals("offer-not-actionable", o.code());
        assertEquals("accepted", o.current().get("state").asText());
        OfferRecord live = OfferFixtures.active("E-1");
        fake.result = new Found(live);
        now = live.expiresAt();
        OfferOutcome late = refusal(access.authorizeDecision(employee("E-1"), OFFER, 7));
        assertEquals(409, late.http());
        assertEquals("offer-not-actionable", late.code());
        assertEquals("expired", late.current().get("state").asText());
    }

    @Test
    void decisionRefusedForTheWrongOwner() {
        fake.result = new Found(OfferFixtures.active("E-2"));
        OfferOutcome o = refusal(access.authorizeDecision(employee("E-1"), OFFER, 7));
        assertEquals(403, o.http());
        assertEquals("offer-not-owned", o.code());
        assertNull(o.current());
    }

    @Test
    void currentListsTheOwnersOffers() {
        fake.listing = new Listed(List.of(new OfferSummary("o-2", "active", NOW), new OfferSummary("o-1", "expired",
                NOW.minusSeconds(60))));
        OfferOutcome o = access.listCurrent(employee("E-1"));
        assertEquals(200, o.http());
        assertEquals(2, o.value().get("offers").size());
        assertEquals("o-2", o.value().get("offers").get(0).get("offerId").asText());
        fake.listing = new Unavailable();
        assertEquals(503, access.listCurrent(employee("E-1")).http());
    }
}
