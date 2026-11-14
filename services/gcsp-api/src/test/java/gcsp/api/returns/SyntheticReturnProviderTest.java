package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class SyntheticReturnProviderTest {

    static final Instant NOW = Instant.parse("2026-11-05T09:00:00Z");
    static final SlotPolicy POLICY = new SlotPolicy(2, 3, 60, List.of("09:00", "13:00"));
    static final AppointmentSlot SLOT = new AppointmentSlot("slot-20261107T0900Z", Instant.parse("2026-11-07T09:00:00Z"),
            Instant.parse("2026-11-07T10:00:00Z"));

    ReturnsFixture f;
    SyntheticReturnProvider provider;

    @BeforeEach
    void setUp() throws Exception {
        f = ReturnsFixture.create();
        provider = new SyntheticReturnProvider(f.pool());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    static ObjectNode obj() {
        return ReturnJson.JSON.createObjectNode();
    }

    ReturnProviderPort.Operation request(String id) {
        return ReturnsFixture.op("request", id, "order-1", SLOT, obj().put("requestedAt", "2026-11-05T09:00:00.000Z"));
    }

    ReturnProviderPort.Operation confirm(String id, boolean propose) {
        ObjectNode payload = obj().put("confirmAfter", "2026-11-05T09:30:00.000Z");
        payload.putObject("scenario").put("proposeChange", propose).put("proposalReason", "The retailer proposed a different time.");
        payload.set("slotPolicy", POLICY.toJson());
        return ReturnsFixture.op("confirm", id, "order-1", SLOT, payload);
    }

    ReturnProviderPort.Operation outcome(String id, String outcome) {
        return ReturnsFixture.op("outcome", id, "order-1", SLOT,
                obj().put("confirmAfter", "2026-11-07T10:30:00.000Z").put("outcome", outcome));
    }

    @Test
    void slotOffersFollowBuildSlots() throws Exception {
        ReturnProviderPort.Offer offer = provider.offerSlots(POLICY, Instant.parse("2026-11-05T17:45:00Z"));
        assertEquals(ReturnProviderPort.Status.OK, offer.status());
        assertTrue(offer.fictional());
        assertEquals(6, offer.slots().size());
        AppointmentSlot first = offer.slots().get(0);
        assertEquals("slot-20261107T0900Z", first.slotId());
        assertEquals(Instant.parse("2026-11-07T09:00:00Z"), first.start());
        assertEquals(Instant.parse("2026-11-07T10:00:00Z"), first.end());
        assertEquals("slot-20261107T1300Z", offer.slots().get(1).slotId());
        assertEquals("slot-20261109T1300Z", offer.slots().get(5).slotId());
        ReturnProviderPort.Offer bad = provider.offerSlots(new SlotPolicy(0, 0, 60, List.of("09:00")), NOW);
        assertEquals(ReturnProviderPort.Status.UNSUPPORTED, bad.status());
        assertEquals("invalid-slot-policy", bad.code());
        assertEquals(0, f.count("SELECT count(*) FROM return_provider_receipts"));
    }

    @Test
    void theAlternativeIsTheNextDailyStartOrNextDaysFirst() {
        AppointmentSlot morning = SyntheticReturnProvider.alternativeAfter(SLOT, POLICY);
        assertEquals("slot-20261107T1300Z", morning.slotId());
        AppointmentSlot last = new AppointmentSlot("x", Instant.parse("2026-11-07T13:00:00Z"), Instant.parse("2026-11-07T14:00:00Z"));
        assertEquals("slot-20261108T0900Z", SyntheticReturnProvider.alternativeAfter(last, POLICY).slotId());
    }

    @Test
    void requestIsAcceptedOnceWithASyntheticReference() throws Exception {
        ReturnProviderPort.Result r = provider.requestSlot(request("op-r1"));
        assertEquals(ReturnProviderPort.Status.ACCEPTED, r.status());
        assertTrue(r.fictional());
        assertEquals(SLOT, r.slot());
        assertEquals("op-r1", r.operationId());
        assertEquals("order-1", r.orderUuid());
        assertEquals("request", r.step());
        assertTrue(r.providerReference().matches("SYN-APT-[0-9A-F]{12}"), r.providerReference());
        assertEquals(1, f.count("SELECT count(*) FROM return_provider_receipts"));
        assertEquals(r.providerReference(), provider.requestSlot(request("op-r1")).providerReference());
        assertEquals(1, f.count("SELECT count(*) FROM return_provider_receipts"));
    }

    @Test
    void theReferenceIsASha256OfTheOperationId() {
        String expected = Canonical.digest(ReturnJson.JSON.createArrayNode().add("synthetic-appointment").add("op-r1"))
                .substring(0, 12).toUpperCase();
        assertEquals("SYN-APT-" + expected, provider.requestSlot(request("op-r1")).providerReference());
        assertTrue(provider.confirmOutcome(outcome("op-o1", "returned"), Instant.parse("2026-11-07T10:30:00Z"))
                .providerReference().matches("SYN-RET-[0-9A-F]{12}"));
    }

    @Test
    void confirmIsInProgressBeforeTheDelayThenScheduled() throws Exception {
        ReturnProviderPort.Operation op = confirm("op-c1", false);
        ReturnProviderPort.Result early = provider.confirm(op, Instant.parse("2026-11-05T09:29:59Z"));
        assertEquals(ReturnProviderPort.Status.IN_PROGRESS, early.status());
        assertNull(early.providerReference());
        assertEquals(0, f.count("SELECT count(*) FROM return_provider_receipts"));
        ReturnProviderPort.Result done = provider.confirm(op, Instant.parse("2026-11-05T09:30:00Z"));
        assertEquals(ReturnProviderPort.Status.SCHEDULED, done.status());
        assertEquals(SLOT, done.slot());
        assertEquals(Instant.parse("2026-11-05T09:30:00Z"), done.at());
        assertEquals(1, f.count("SELECT count(*) FROM return_provider_receipts"));
        ReturnProviderPort.Result later = provider.confirm(op, Instant.parse("2026-11-06T00:00:00Z"));
        assertEquals(done, later);
    }

    @Test
    void confirmProposesTheNextSlotWhenTheScenarioSaysSo() throws Exception {
        ReturnProviderPort.Operation op = confirm("op-c2", true);
        ReturnProviderPort.Result r = provider.confirm(op, Instant.parse("2026-11-05T10:00:00Z"));
        assertEquals(ReturnProviderPort.Status.PROPOSED, r.status());
        assertEquals("slot-20261107T1300Z", r.proposedSlot().slotId());
        assertEquals(SLOT, r.slot());
        assertEquals(r.providerReference(), r.proposalId());
        assertEquals("The retailer proposed a different time.", r.reason());
        ObjectNode accept = obj().put("acceptedAt", "2026-11-05T11:00:00.000Z");
        accept.set("proposedSlot", r.proposedSlot().toJson());
        ReturnProviderPort.Result accepted = provider.acceptProposal(ReturnsFixture.op("accept", "op-a1", "order-1", SLOT, accept));
        assertEquals(ReturnProviderPort.Status.SCHEDULED, accepted.status());
        assertEquals(r.proposedSlot(), accepted.slot());
        assertEquals(Instant.parse("2026-11-05T11:00:00Z"), accepted.at());
    }

    @Test
    void outcomeIsInProgressBeforeTheDelayThenThePinnedResult() throws Exception {
        for (String keyed : new String[] {"returned", "missed"}) {
            ReturnProviderPort.Operation op = outcome("op-o-" + keyed, keyed);
            assertEquals(ReturnProviderPort.Status.IN_PROGRESS, provider.confirmOutcome(op, Instant.parse("2026-11-07T10:29:59Z")).status());
            ReturnProviderPort.Result r = provider.confirmOutcome(op, Instant.parse("2026-11-07T10:30:00Z"));
            assertEquals(keyed, r.status().wire());
            assertEquals(SLOT, r.slot());
            assertEquals(Instant.parse("2026-11-07T10:30:00Z"), r.at());
            assertTrue(r.fictional());
            assertEquals(r, provider.confirmOutcome(op, Instant.parse("2026-11-08T00:00:00Z")));
        }
        assertEquals(2, f.count("SELECT count(*) FROM return_provider_receipts WHERE step = 'outcome'"));
    }

    @Test
    void aChangedDigestForTheSameOperationIsAConflict() throws Exception {
        provider.requestSlot(request("op-x"));
        ReturnProviderPort.Operation changed = ReturnsFixture.op("request", "op-x", "order-1", SLOT, obj().put("requestedAt", "2026-11-05T09:01:00.000Z"));
        ReturnProviderPort.Result r = provider.requestSlot(changed);
        assertEquals(ReturnProviderPort.Status.CONFLICT, r.status());
        assertEquals("idempotency-input-changed", r.code());
        assertEquals(ReturnProviderPort.Status.CONFLICT, provider.reconcile(changed).status());
        assertEquals(1, f.count("SELECT count(*) FROM return_provider_receipts"));
    }

    @Test
    void reconcileReturnsTheStoredAnswerOrNotFound() throws Exception {
        ReturnProviderPort.Operation op = request("op-rec");
        ReturnProviderPort.Result missing = provider.reconcile(op);
        assertEquals(ReturnProviderPort.Status.NOT_FOUND, missing.status());
        assertEquals("op-rec", missing.operationId());
        assertEquals("order-1", missing.orderUuid());
        assertEquals(0, f.count("SELECT count(*) FROM return_provider_receipts"));
        ReturnProviderPort.Result sent = provider.requestSlot(op);
        assertEquals(sent, provider.reconcile(op));
        ReturnProviderPort.Operation notYet = confirm("op-never", false);
        assertEquals(ReturnProviderPort.Status.NOT_FOUND, provider.reconcile(notYet).status());
        provider.confirm(notYet, Instant.parse("2026-11-05T09:00:00Z"));
        assertEquals(ReturnProviderPort.Status.NOT_FOUND, provider.reconcile(notYet).status());
    }

    @Test
    void malformedOperationsAreRefusedAndWriteNothing() throws Exception {
        ReturnProviderPort.Operation noTime = ReturnsFixture.op("request", "op-bad", "order-1", SLOT, obj());
        ReturnProviderPort.Result r = provider.requestSlot(noTime);
        assertEquals(ReturnProviderPort.Status.UNSUPPORTED, r.status());
        assertEquals("invalid-return-operation", r.code());
        ReturnProviderPort.Operation wrongStep = ReturnsFixture.op("confirm", "op-bad", "order-1", SLOT, obj().put("requestedAt", "2026-11-05T09:00:00.000Z"));
        assertEquals(ReturnProviderPort.Status.UNSUPPORTED, provider.requestSlot(wrongStep).status());
        assertEquals(ReturnProviderPort.Status.UNSUPPORTED, provider.confirmOutcome(outcome("op-bad2", "lost"), NOW.plusSeconds(10_000_000)).status());
        assertEquals(0, f.count("SELECT count(*) FROM return_provider_receipts"));
        assertNotNull(r.reason());
    }

    @Test
    void theLiveStubRefusesEveryCallAndWritesNothing() throws Exception {
        LiveReturnProviderStub live = new LiveReturnProviderStub();
        assertEquals("live", live.mode());
        ReturnProviderPort.Result a = live.requestSlot(request("op-l1"));
        assertEquals(ReturnProviderPort.Status.UNSUPPORTED, a.status());
        assertEquals("live-appointments-unsupported", a.code());
        assertEquals("op-l1", a.operationId());
        assertEquals("live-appointments-unsupported", live.confirm(confirm("op-l2", false), NOW).code());
        assertEquals("live-appointments-unsupported", live.acceptProposal(confirm("op-l3", false)).code());
        assertEquals("live-appointments-unsupported", live.reconcile(request("op-l4")).code());
        ReturnProviderPort.Result o = live.confirmOutcome(outcome("op-l5", "returned"), NOW);
        assertEquals("live-return-outcomes-unsupported", o.code());
        assertEquals("live-return-outcomes-unsupported", live.reconcile(outcome("op-l6", "returned")).code());
        ReturnProviderPort.Offer offer = live.offerSlots(POLICY, NOW);
        assertEquals(ReturnProviderPort.Status.UNSUPPORTED, offer.status());
        assertEquals("live-appointments-unsupported", offer.code());
        assertTrue(offer.slots().isEmpty());
        assertTrue(!a.fictional());
        assertEquals(0, f.count("SELECT count(*) FROM return_provider_receipts"));
    }

    @Test
    void theUnconfiguredProviderIsUnavailable() {
        UnconfiguredReturnProvider none = new UnconfiguredReturnProvider();
        assertEquals("none", none.mode());
        assertEquals(ReturnProviderPort.Status.UNAVAILABLE, none.requestSlot(request("op-n")).status());
        assertEquals("return-provider-unavailable", none.reconcile(request("op-n")).code());
    }

    @Test
    void aResultSurvivesItsJsonRoundTrip() {
        ReturnProviderPort.Result r = provider.confirm(confirm("op-rt", true), Instant.parse("2026-11-05T10:00:00Z"));
        assertEquals(r, ReturnProviderPort.Result.fromJson(r.toJson()));
    }
}
