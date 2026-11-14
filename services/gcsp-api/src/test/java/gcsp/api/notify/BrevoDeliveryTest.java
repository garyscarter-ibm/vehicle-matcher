package gcsp.api.notify;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

import gcsp.api.persistence.Outcome;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class BrevoDeliveryTest {

    static final String EVENT = "notification:offer:off-1:v1";

    NotifyFixture f;
    NotifyFixture.Clock clock;
    Doubles.Facts facts;
    BrevoStub stub;
    NotificationDispatcher dispatcher;

    @BeforeEach
    void setUp() throws Exception {
        f = NotifyFixture.create();
        clock = new NotifyFixture.Clock();
        facts = new Doubles.Facts();
        stub = new BrevoStub();
        f.update("INSERT INTO notification_recipients (environment_id, run_id, employee_id, delivery_email, version) "
                + "VALUES (?, 'run-1', 'emp-1', 'alex@example.test', 1)", NotifyFixture.ENV);
        BrevoSettings settings = new BrevoSettings("test-key-not-secret-0123456789", "sender@example.test", "Demo",
                java.net.URI.create("https://demo.example/"), stub.endpoint(), Duration.ofMillis(500));
        BrevoTransport transport = new BrevoTransport(f.pool(), settings, clock,
                BrevoTransport.newClient(Duration.ofMillis(500)));
        dispatcher = new NotificationDispatcher(f.pool(), new Doubles.Rules(), facts, transport, clock,
                NotifyFixture.ENV, Optional.of("https://demo.example"));
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (stub != null) stub.close();
        if (f != null) f.close();
    }

    DispatchResult.Counts drain() {
        return assertInstanceOf(DispatchResult.Counts.class, dispatcher.dispatchPending());
    }

    @Test
    void intentToSentThroughTheProvider() throws Exception {
        stub.then(BrevoStub.created("msg-1"));
        assertInstanceOf(Outcome.Committed.class, f.createOffer("off-1", "emp-1"));
        assertEquals(new DispatchResult.Counts(1, 0, 0), drain());
        assertEquals("sent", f.delivery("state", EVENT));
        assertEquals("configured", f.delivery("transport", EVENT));
        assertEquals("delivered", f.outbox("state", EVENT));
        assertEquals(1, stub.requests.size());
        assertEquals("acknowledged", f.text("SELECT state FROM pending_operations"));
    }

    @Test
    void retryable503ThenCreatedKeepsOneIdempotencyKey() throws Exception {
        stub.then(BrevoStub.reply(503, "{}")).then(BrevoStub.created("msg-2"));
        f.createOffer("off-1", "emp-1");
        assertEquals(new DispatchResult.Counts(0, 1, 0), drain());
        assertEquals("retrying", f.delivery("state", EVENT));
        assertEquals("provider-unavailable", f.delivery("error", EVENT));
        clock.advance(30);
        assertEquals(new DispatchResult.Counts(1, 0, 0), drain());
        assertEquals("sent", f.delivery("state", EVENT));
        assertNull(f.delivery("error", EVENT));
        assertEquals(2, stub.requests.size());
        String k0 = NotifyFixture.JSON.readTree(stub.requests.get(0).body()).path("headers").path("idempotencyKey").asText();
        String k1 = NotifyFixture.JSON.readTree(stub.requests.get(1).body()).path("headers").path("idempotencyKey").asText();
        assertEquals(k0, k1);
        assertEquals(1, f.count("SELECT count(*) FROM pending_operations"));
    }

    @Test
    void acknowledgedCustodyWinsEvenIfTheOfferExpiredSince() throws Exception {
        stub.then(BrevoStub.created("msg-3"));
        f.createOffer("off-1", "emp-1");
        // The provider acknowledged but the sent commit never happened: custody says acknowledged, delivery is open.
        BrevoTransport earlier = new BrevoTransport(f.pool(), new BrevoSettings("test-key-not-secret-0123456789",
                "sender@example.test", "Demo", java.net.URI.create("https://demo.example/"), stub.endpoint(),
                Duration.ofMillis(500)), clock, BrevoTransport.newClient(Duration.ofMillis(500)));
        OfferMessage m = new OfferMessage(new OfferMessage.Recipient("emp-1", "Alex"), "S", "t", "h",
                "https://demo.example/gcsp/offers/off-1", null);
        assertInstanceOf(MailTransport.Accepted.class, earlier.send(f.ctx(), new DeliveryAttempt(EVENT, 1, "emp-1"), m));
        assertEquals(1, stub.requests.size());
        facts.fallback = new OfferFacts.Offer("off-1", "emp-1", "expired", clock.instant().minusSeconds(10), "Car", 1, null);
        assertEquals(new DispatchResult.Counts(1, 0, 0), drain());
        assertEquals("sent", f.delivery("state", EVENT));
        assertEquals(1, stub.requests.size(), "no second call, and no offer-expired failure");
    }
}
