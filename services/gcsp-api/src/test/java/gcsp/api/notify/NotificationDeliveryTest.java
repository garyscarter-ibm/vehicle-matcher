package gcsp.api.notify;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunReset;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class NotificationDeliveryTest {

    static final String EVENT = "notification:offer:off-1:v1";

    NotifyFixture f;
    NotifyFixture.Clock clock;
    Doubles.Rules rules;
    Doubles.Facts facts;
    Doubles.Mail mail;

    @BeforeEach
    void setUp() throws SQLException {
        f = NotifyFixture.create();
        clock = new NotifyFixture.Clock();
        rules = new Doubles.Rules();
        facts = new Doubles.Facts();
        mail = new Doubles.Mail();
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    NotificationDispatcher dispatcher(Optional<String> base) throws SQLException {
        return new NotificationDispatcher(f.pool(), rules, facts, mail, clock, NotifyFixture.ENV, base);
    }

    DispatchResult.Counts drain(NotificationDispatcher d) {
        return assertInstanceOf(DispatchResult.Counts.class, d.dispatchPending());
    }

    void offer(String offerId, String employeeId) throws SQLException {
        assertInstanceOf(Outcome.Committed.class, f.createOffer(offerId, employeeId));
    }

    // ordering

    @Test
    void intentCommitsWithBusinessRowReceiptAndRevision() throws Exception {
        offer("off-1", "emp-1");
        assertEquals(1, f.count("SELECT count(*) FROM stock_cars WHERE order_uuid = 'car-off-1'"));
        assertEquals(1, f.count("SELECT count(*) FROM command_receipts WHERE command_id = 'create-off-1'"));
        assertEquals("1", f.text("SELECT revision FROM runs WHERE run_id = 'run-1'"));
        assertEquals("1", f.outbox("run_revision", EVENT));
        assertEquals("notification.offer.v1", f.outbox("event_type", EVENT));
        assertEquals("pending", f.outbox("state", EVENT));
        assertEquals("offer", f.text("SELECT payload->>'messageKind' FROM outbox_events"));
        assertEquals("1", f.text("SELECT payload->>'messageVersion' FROM outbox_events"));
        assertEquals("off-1", f.text("SELECT payload->>'offerId' FROM outbox_events"));
        assertEquals("emp-1", f.text("SELECT payload->>'recipientEmployeeId' FROM outbox_events"));
        assertEquals("/gcsp/offers/off-1", f.text("SELECT payload->>'offerLink' FROM outbox_events"));
        assertEquals(5, f.count("SELECT count(*) FROM outbox_events o, jsonb_object_keys(o.payload)"));
    }

    @Test
    void refusedOrRolledBackCommandLeavesNoIntentAndDispatchSeesNothing() throws Exception {
        TransactionRunner runner = new TransactionRunner(f.pool());
        Outcome o = runner.execute(f.ctx(), new Command("offer.create", "c-x", NotifyFixture.obj().put("a", 1)), tx -> {
            NotificationIntent.offer(tx, "off-9", "emp-1");
            tx.write("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                    + "VALUES (?, 'run-1', 'x', 'c', 's')", NotifyFixture.ENV);
            return WorkResult.refuse("nope", "no");
        });
        assertInstanceOf(Outcome.Refused.class, o);
        assertThrows(IllegalStateException.class, () -> runner.execute(f.ctx(),
                new Command("offer.create", "c-y", NotifyFixture.obj().put("a", 2)), tx -> {
                    tx.write("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                            + "VALUES (?, 'run-1', 'y', 'c', 's')", NotifyFixture.ENV);
                    NotificationIntent.offer(tx, "off-8", "emp-1");
                    throw new IllegalStateException("boom");
                }));
        assertEquals(0, f.count("SELECT count(*) FROM outbox_events"));
        assertEquals(0, f.count("SELECT count(*) FROM stock_cars"));
        assertEquals(new DispatchResult.Counts(0, 0, 0), drain(dispatcher(Optional.empty())));
        assertEquals(0, mail.calls.size());
    }

    @Test
    void dispatcherSeesNothingWhileTheBusinessTransactionIsOpen() throws Exception {
        NotificationDispatcher d = dispatcher(Optional.empty());
        DispatchResult[] during = new DispatchResult[1];
        Outcome o = new TransactionRunner(f.pool()).execute(f.ctx(), new Command("offer.create", "c-open",
                NotifyFixture.obj().put("a", 1)), tx -> {
                    NotificationIntent.offer(tx, "off-1", "emp-1");
                    tx.write("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                            + "VALUES (?, 'run-1', 'z', 'c', 's')", NotifyFixture.ENV);
                    during[0] = d.dispatchPending();
                    return WorkResult.ok(NotifyFixture.obj());
                });
        assertInstanceOf(Outcome.Committed.class, o);
        assertEquals(new DispatchResult.Counts(0, 0, 0), during[0]);
        assertEquals(0, mail.calls.size());
        assertEquals(new DispatchResult.Counts(1, 0, 0), drain(d));
    }

    @Test
    void noOpCommandEmitsNoIntentAndDuplicateOfferIsAConflict() throws Exception {
        Outcome noop = new TransactionRunner(f.pool()).execute(f.ctx(), new Command("offer.noop", "c-n",
                NotifyFixture.obj().put("a", 1)), tx -> {
                    NotificationIntent.offer(tx, "off-1", "emp-1");
                    return WorkResult.ok(NotifyFixture.obj());
                });
        assertFalse(assertInstanceOf(Outcome.Committed.class, noop).changed());
        assertEquals(0, f.count("SELECT count(*) FROM outbox_events"));
        offer("off-1", "emp-1");
        Outcome dup = new TransactionRunner(f.pool()).execute(f.ctx(), new Command("offer.create", "create-again",
                NotifyFixture.obj().put("offerId", "off-1")), tx -> {
                    tx.write("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                            + "VALUES (?, 'run-1', 'other', 'c', 's')", NotifyFixture.ENV);
                    NotificationIntent.offer(tx, "off-1", "emp-1");
                    return WorkResult.ok(NotifyFixture.obj());
                });
        assertEquals("duplicate-record", assertInstanceOf(Outcome.Conflict.class, dup).code());
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events"));
    }

    @Test
    void intentValidatesIds() throws Exception {
        new TransactionRunner(f.pool()).execute(f.ctx(), new Command("t", "c-v", NotifyFixture.obj().put("a", 1)), tx -> {
            assertThrows(IllegalArgumentException.class, () -> NotificationIntent.offer(tx, " ", "emp-1"));
            assertThrows(IllegalArgumentException.class, () -> NotificationIntent.offer(tx, "o".repeat(129), "emp-1"));
            assertThrows(IllegalArgumentException.class, () -> NotificationIntent.offer(tx, "o\n1", "emp-1"));
            assertThrows(IllegalArgumentException.class, () -> NotificationIntent.offer(tx, "o1", null));
            return WorkResult.ok(NotifyFixture.obj());
        });
    }

    // captured delivery

    @Test
    void capturedSuccessStoresMessageAndMarksSent() throws Exception {
        offer("off-1", "emp-1");
        assertEquals(new DispatchResult.Counts(1, 0, 0), drain(dispatcher(Optional.of("https://demo.example"))));
        assertEquals(1, mail.calls.size());
        assertEquals("sent", f.delivery("state", EVENT));
        assertEquals("captured", f.delivery("transport", EVENT));
        assertEquals("1", f.delivery("attempts", EVENT));
        assertNull(f.delivery("error", EVENT));
        assertEquals("delivered", f.outbox("state", EVENT));
        assertEquals("1", f.outbox("attempts", EVENT));
        assertEquals("Alex Example", f.text("SELECT message->'recipient'->>'name' FROM notification_deliveries"));
        assertEquals("emp-1", f.text("SELECT message->'recipient'->>'employeeId' FROM notification_deliveries"));
        assertEquals("Your vehicle offer is ready to review", f.text("SELECT message->>'subject' FROM notification_deliveries"));
        assertEquals("https://demo.example/gcsp/offers/off-1", f.text("SELECT message->>'offerLink' FROM notification_deliveries"));
        assertTrue(f.text("SELECT message->>'textBody' FROM notification_deliveries")
                .contains("Respond by 11:30 on Tuesday 17 November."));
        assertEquals(new DispatchResult.Counts(0, 0, 0), drain(dispatcher(Optional.empty())));
        assertEquals(1, mail.calls.size());
    }

    @Test
    void relativeLinkWithoutBaseAndEncodedOfferId() throws Exception {
        offer("off-1", "emp-1");
        drain(dispatcher(Optional.empty()));
        assertEquals("/gcsp/offers/off-1", f.text("SELECT message->>'offerLink' FROM notification_deliveries"));
        offer("a b/c", "emp-1");
        drain(dispatcher(Optional.of("https://demo.example")));
        assertEquals("https://demo.example/gcsp/offers/a%20b%2Fc", f.text(
                "SELECT message->>'offerLink' FROM notification_deliveries WHERE event_id = 'notification:offer:a b/c:v1'"));
        assertEquals("/gcsp/offers/a%20b%2Fc", f.text(
                "SELECT payload->>'offerLink' FROM outbox_events WHERE event_id = 'notification:offer:a b/c:v1'"));
    }

    @Test
    void invalidPublicBaseIsRejectedAtConstruction() {
        assertThrows(IllegalArgumentException.class, () -> dispatcher(Optional.of("http://demo.example")));
    }

    // retry

    @Test
    void retryableFailuresBackOffThenFail() throws Exception {
        mail.then(Doubles::retryable);
        offer("off-1", "emp-1");
        NotificationDispatcher d = dispatcher(Optional.empty());
        assertEquals(new DispatchResult.Counts(0, 1, 0), drain(d));
        assertEquals("retrying", f.delivery("state", EVENT));
        assertEquals("provider-unavailable", f.delivery("error", EVENT));
        assertEquals(NotifyFixture.T0.plusSeconds(30), java.time.Instant.parse(f.text(
                "SELECT to_char(next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                        + "FROM notification_deliveries")));
        assertEquals("pending", f.outbox("state", EVENT));
        String stored = f.delivery("message", EVENT);

        clock.advance(29);
        assertEquals(new DispatchResult.Counts(0, 0, 0), drain(d));
        assertEquals(1, mail.calls.size());
        clock.advance(1);
        assertEquals(new DispatchResult.Counts(0, 1, 0), drain(d));
        assertEquals("2", f.delivery("attempts", EVENT));
        assertEquals(NotifyFixture.T0.plusSeconds(30 + 60), java.time.Instant.parse(f.text(
                "SELECT to_char(next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                        + "FROM notification_deliveries")));
        clock.advance(60);
        assertEquals(new DispatchResult.Counts(0, 0, 1), drain(d));
        assertEquals("failed", f.delivery("state", EVENT));
        assertEquals("failed", f.outbox("state", EVENT));
        assertEquals("3", f.outbox("attempts", EVENT));
        assertNull(f.delivery("next_attempt_at", EVENT));
        assertEquals(3, mail.calls.size());
        assertEquals(stored, f.delivery("message", EVENT));
        assertEquals(1, mail.messages.stream().distinct().count(), "one stored message is reused by every attempt");
        clock.advance(10000);
        assertEquals(new DispatchResult.Counts(0, 0, 0), drain(d));
        assertEquals(3, mail.calls.size());
    }

    @Test
    void retryThenAcceptedMarksSentWithAttemptsMirrored() throws Exception {
        mail.then(Doubles::retryable).then(Doubles::accepted);
        offer("off-1", "emp-1");
        NotificationDispatcher d = dispatcher(Optional.empty());
        drain(d);
        clock.advance(30);
        assertEquals(new DispatchResult.Counts(1, 0, 0), drain(d));
        assertEquals("2", f.outbox("attempts", EVENT));
        assertEquals("delivered", f.outbox("state", EVENT));
        assertNull(f.delivery("error", EVENT));
    }

    @Test
    void nonRetryableTransportFailureFailsAtAttemptOne() throws Exception {
        mail.then(() -> new MailTransport.Failed("provider-rejected", false));
        offer("off-1", "emp-1");
        assertEquals(new DispatchResult.Counts(0, 0, 1), drain(dispatcher(Optional.empty())));
        assertEquals("provider-rejected", f.delivery("error", EVENT));
        assertEquals("failed", f.outbox("state", EVENT));
    }

    @Test
    void unknownTransportCodeBecomesTransportUnavailable() throws Exception {
        mail.then(() -> new MailTransport.Failed("secret text at a@b.example", true));
        offer("off-1", "emp-1");
        drain(dispatcher(Optional.empty()));
        assertEquals("transport-unavailable", f.delivery("error", EVENT));
    }

    @Test
    void nonRetryableFactFailuresFailAtAttemptOne() throws Exception {
        record Case(String offerId, String code, java.util.function.Consumer<Doubles.Facts> arrange) {}
        List<Case> cases = List.of(
                new Case("o-mismatch", "recipient-mismatch", x -> x.byOffer.put("o-mismatch", Doubles.active("o-mismatch", "emp-2"))),
                new Case("o-expired", "offer-expired", x -> x.byOffer.put("o-expired", new OfferFacts.Offer("o-expired", "emp-1",
                        "active", NotifyFixture.T0, "Car", 1, null))),
                new Case("o-state-expired", "offer-expired", x -> x.byOffer.put("o-state-expired", new OfferFacts.Offer(
                        "o-state-expired", "emp-1", "expired", NotifyFixture.T0.plusSeconds(999), "Car", 1, null))),
                new Case("o-inactive", "offer-inactive", x -> x.byOffer.put("o-inactive", new OfferFacts.Offer("o-inactive",
                        "emp-1", "withdrawn", NotifyFixture.T0.plusSeconds(999), "Car", 1, null))),
                new Case("o-missing", "message-facts-unavailable", x -> x.byOffer.put("o-missing", new OfferFacts.Missing())));
        for (Case c : cases) {
            c.arrange().accept(facts);
            offer(c.offerId(), "emp-1");
        }
        assertEquals(new DispatchResult.Counts(0, 0, cases.size()), drain(dispatcher(Optional.empty())));
        for (Case c : cases) {
            String id = "notification:offer:" + c.offerId() + ":v1";
            assertEquals(c.code(), f.delivery("error", id), c.offerId());
            assertEquals("failed", f.outbox("state", id));
            assertEquals("1", f.delivery("attempts", id));
        }
        assertEquals(0, mail.calls.size());
    }

    @Test
    void missingEmployeeAndUnsupportedVersionFail() throws Exception {
        offer("o-noemp", "ghost");
        f.update("INSERT INTO outbox_events (environment_id, run_id, event_id, actor_id, command_id, event_type, payload, run_revision) "
                + "SELECT environment_id, run_id, 'notification:offer:v2:v1', actor_id, command_id, 'notification.offer.v1', "
                + "'{\"messageKind\":\"offer\",\"messageVersion\":\"2\",\"offerId\":\"v2\",\"recipientEmployeeId\":\"emp-1\","
                + "\"offerLink\":\"/gcsp/offers/v2\"}'::jsonb, run_revision FROM outbox_events WHERE event_id = 'notification:offer:o-noemp:v1'");
        assertEquals(new DispatchResult.Counts(0, 0, 2), drain(dispatcher(Optional.empty())));
        assertEquals("message-facts-unavailable", f.delivery("error", "notification:offer:o-noemp:v1"));
        assertEquals("message-version-unsupported", f.delivery("error", "notification:offer:v2:v1"));
    }

    @Test
    void transportThrowingIsRetryableAndKeepsNoExceptionText() throws Exception {
        mail.then(() -> {
            throw new IllegalStateException("leaky-secret-text key=abc123 a@b.example");
        });
        offer("off-1", "emp-1");
        assertEquals(new DispatchResult.Counts(0, 1, 0), drain(dispatcher(Optional.empty())));
        assertEquals("transport-unavailable", f.delivery("error", EVENT));
        assertEquals(0, f.count("SELECT count(*) FROM notification_deliveries d, outbox_events o, command_receipts r "
                + "WHERE d::text LIKE '%leaky%' OR o::text LIKE '%leaky%' OR r::text LIKE '%leaky%' OR d::text LIKE '%abc123%'"));
    }

    @Test
    void rulesUnavailableClaimsNothing() throws Exception {
        offer("off-1", "emp-1");
        rules.result = new DeliveryRules.Unavailable();
        NotificationDispatcher d = dispatcher(Optional.empty());
        assertInstanceOf(DispatchResult.Unavailable.class, d.dispatchPending());
        rules.result = new DeliveryRules.Rules("t", 3, 30, 10);
        assertInstanceOf(DispatchResult.Unavailable.class, d.dispatchPending());
        assertEquals(0, f.count("SELECT count(*) FROM notification_deliveries"));
        assertEquals(0, mail.calls.size());
        assertInstanceOf(DispatchResult.Unavailable.class, new NotificationDispatcher(f.pool(),
                new UnconfiguredDeliveryRules(), facts, mail, clock, NotifyFixture.ENV, Optional.empty()).dispatchPending());
    }

    @Test
    void offerFactsUnavailableRetries() throws Exception {
        facts.fallback = new OfferFacts.Unavailable();
        offer("off-1", "emp-1");
        assertEquals(new DispatchResult.Counts(0, 1, 0), drain(dispatcher(Optional.empty())));
        assertEquals("transport-unavailable", f.delivery("error", EVENT));
        assertNull(f.delivery("message", EVENT));
        facts.fallback = null;
        clock.advance(30);
        assertEquals(new DispatchResult.Counts(1, 0, 0), drain(dispatcher(Optional.empty())));
        assertEquals(1, mail.calls.size());
        assertInstanceOf(DispatchResult.Counts.class, new NotificationDispatcher(f.pool(), rules,
                new UnconfiguredOfferFacts(), mail, clock, NotifyFixture.ENV, Optional.empty()).dispatchPending());
    }

    // lease and concurrency

    @Test
    void sendingLeaseIsRespected() throws Exception {
        offer("off-1", "emp-1");
        f.update("INSERT INTO notification_deliveries (environment_id, run_id, event_id, state, attempts, attempted_at) "
                + "VALUES (?, 'run-1', ?, 'sending', 1, ?)", NotifyFixture.ENV, EVENT,
                NotifyFixture.T0.minusSeconds(59).atOffset(java.time.ZoneOffset.UTC));
        NotificationDispatcher d = dispatcher(Optional.empty());
        assertEquals(new DispatchResult.Counts(0, 0, 0), drain(d));
        assertEquals(0, mail.calls.size());
        clock.advance(1);
        assertEquals(new DispatchResult.Counts(1, 0, 0), drain(d));
        assertEquals(1, mail.calls.size());
        assertEquals("2", f.delivery("attempts", EVENT));
        assertEquals("sent", f.delivery("state", EVENT));
    }

    @Test
    void twoDispatchersDeliverEachJobOnce() throws Exception {
        for (int i = 0; i < 6; i++) offer("off-" + i, "emp-1");
        NotificationDispatcher a = dispatcher(Optional.empty());
        NotificationDispatcher b = dispatcher(Optional.empty());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<DispatchResult> fa = pool.submit(a::dispatchPending);
            Future<DispatchResult> fb = pool.submit(b::dispatchPending);
            fa.get(60, TimeUnit.SECONDS);
            fb.get(60, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        drain(a);
        assertEquals(6, mail.calls.size());
        assertEquals(6, mail.calls.stream().map(DeliveryAttempt::eventId).distinct().count());
        assertEquals(6, f.count("SELECT count(*) FROM notification_deliveries WHERE state = 'sent' AND attempts = 1"));
        assertEquals(6, f.count("SELECT count(*) FROM outbox_events WHERE state = 'delivered'"));
    }

    // run retirement

    @Test
    void retiredRunsJobsAreNotDeliveredAndGainNoState() throws Exception {
        offer("off-1", "emp-1");
        String db = f.database();
        Outcome reset = new RunReset(f.pool(), db, NotifyFixture.ENV).reset(NotifyFixture.ENV, "operator", "reset-1", "run-1", "run-2");
        assertInstanceOf(Outcome.Committed.class, reset);
        NotificationDispatcher d = dispatcher(Optional.empty());
        assertEquals(new DispatchResult.Counts(0, 0, 0), drain(d));
        assertEquals(0, mail.calls.size());
        assertEquals(0, f.count("SELECT count(*) FROM notification_deliveries"));
        assertEquals("pending", f.outbox("state", EVENT));
    }

    @Test
    void runRetiredMidDrainEndsWithStaleRunAndWritesNothingNew() throws Exception {
        offer("off-1", "emp-1");
        String db = f.database();
        mail.beforeSend = () -> {
            try {
                new RunReset(f.pool(), db, NotifyFixture.ENV).reset(NotifyFixture.ENV, "operator", "reset-2", "run-1", "run-2");
            } catch (SQLException e) {
                throw new IllegalStateException(e);
            }
        };
        assertInstanceOf(DispatchResult.StaleRun.class, dispatcher(Optional.empty()).dispatchPending());
        assertEquals("sending", f.delivery("state", EVENT));
        assertEquals("pending", f.outbox("state", EVENT));
        assertEquals(0, f.count("SELECT count(*) FROM notification_deliveries WHERE run_id = 'run-2'"));
    }

    @Test
    void transportStaleRunEndsTheDrain() throws Exception {
        mail.then(MailTransport.StaleRun::new);
        offer("off-1", "emp-1");
        assertInstanceOf(DispatchResult.StaleRun.class, dispatcher(Optional.empty()).dispatchPending());
        assertEquals("sending", f.delivery("state", EVENT));
    }

    // view

    @Test
    void outboxViewIsSafeAndNewestFirst() throws Exception {
        offer("off-1", "emp-1");
        NotificationDispatcher d = dispatcher(Optional.empty());
        drain(d);
        clock.advance(100);
        offer("off-2", "emp-2");
        f.update("INSERT INTO notification_recipients (environment_id, run_id, employee_id, delivery_email) "
                + "VALUES (?, 'run-1', 'emp-1', 'private.person@example.invalid')", NotifyFixture.ENV);
        f.update("UPDATE notification_deliveries SET provider_operation_id = 'prov-secret-1'");
        f.update("UPDATE outbox_events SET created_at = ?::timestamptz WHERE event_id = 'notification:offer:off-2:v1'",
                NotifyFixture.T0.plusSeconds(100).toString());
        f.update("UPDATE notification_deliveries SET updated_at = ?::timestamptz",
                NotifyFixture.T0.toString());
        List<OutboxView.Message> rows = OutboxView.list(f.pool(), f.ctx(), 50);
        assertEquals(2, rows.size());
        assertEquals("notification:offer:off-2:v1", rows.get(0).jobId());
        assertEquals("pending", rows.get(0).state());
        assertEquals("emp-2", rows.get(0).recipient().employeeId());
        assertNull(rows.get(0).subject());
        OutboxView.Message sent = rows.get(1);
        assertEquals("sent", sent.state());
        assertEquals("captured", sent.transport());
        assertEquals("offer", sent.messageKind());
        assertEquals("Alex Example", sent.recipient().name());
        assertEquals("Your vehicle offer is ready to review", sent.subject());
        assertEquals("/gcsp/offers/off-1", sent.offerLink());
        assertEquals(1, sent.attempts());
        assertNull(sent.error());
        String all = rows.toString();
        assertFalse(all.contains("private.person"));
        assertFalse(all.contains("prov-secret"));
        assertFalse(all.contains("payload"));
        assertEquals(1, OutboxView.list(f.pool(), f.ctx(), 1).size());
        assertEquals("private.person@example.invalid", NotificationRecipients.read(f.pool(), f.ctx(), "emp-1")
                .orElseThrow().deliveryEmail());
        assertTrue(NotificationRecipients.read(f.pool(), f.ctx(), "emp-2").isEmpty());
    }
}
