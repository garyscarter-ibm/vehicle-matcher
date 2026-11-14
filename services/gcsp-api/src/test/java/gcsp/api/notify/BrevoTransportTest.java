package gcsp.api.notify;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class BrevoTransportTest {

    static final String KEY = "test-key-not-secret-0123456789";
    static final String EVENT = "notification:offer:off-1:v1";
    static final String LINK = "https://demo.example/gcsp/offers/off-1";

    NotifyFixture f;
    NotifyFixture.Clock clock;
    BrevoStub stub;
    BrevoTransport transport;
    final DeliveryAttempt attempt = new DeliveryAttempt(EVENT, 1, "emp-1");

    @BeforeEach
    void setUp() throws Exception {
        f = NotifyFixture.create();
        clock = new NotifyFixture.Clock();
        stub = new BrevoStub();
        setEmail("emp-1", "alex@example.test");
        transport = transport(stub.endpoint());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (stub != null) stub.close();
        if (f != null) f.close();
    }

    BrevoTransport transport(java.net.URI endpoint) throws SQLException {
        BrevoSettings settings = new BrevoSettings(KEY, "sender@example.test", "Demo Sender",
                java.net.URI.create("https://demo.example/"), endpoint, Duration.ofMillis(500));
        return new BrevoTransport(f.pool(), settings, clock, BrevoTransport.newClient(Duration.ofMillis(500)));
    }

    void setEmail(String employee, String email) throws SQLException {
        f.update("INSERT INTO notification_recipients (environment_id, run_id, employee_id, delivery_email, version) "
                + "VALUES (?, 'run-1', ?, ?, 1) ON CONFLICT (environment_id, run_id, employee_id) "
                + "DO UPDATE SET delivery_email = EXCLUDED.delivery_email", NotifyFixture.ENV, employee, email);
    }

    OfferMessage message(String link) {
        return new OfferMessage(new OfferMessage.Recipient("emp-1", "Alex Example"), "Your vehicle offer is ready",
                "Review it at " + link, "<p>Review it at " + link + "</p>", link, null);
    }

    MailTransport.Result send() {
        return transport.send(f.ctx(), attempt, message(LINK));
    }

    JsonNode body(int i) throws Exception {
        return NotifyFixture.JSON.readTree(stub.requests.get(i).body());
    }

    String op(String column) throws SQLException {
        return f.text("SELECT " + column + "::text FROM pending_operations WHERE operation_id = ?", "mail:" + EVENT);
    }

    @Test
    void createdWithMessageIdIsAcceptedAndAcknowledged() throws Exception {
        stub.then(BrevoStub.created("<abc.123@example.test>"));
        assertInstanceOf(MailTransport.Accepted.class, send());
        assertEquals(1, stub.requests.size());
        BrevoStub.Request r = stub.requests.get(0);
        assertEquals("POST", r.method());
        assertEquals(KEY, r.headers().get("api-key"));
        assertEquals("application/json", r.headers().get("accept"));
        JsonNode b = body(0);
        assertEquals("alex@example.test", b.path("to").path(0).path("email").asText());
        assertEquals("sender@example.test", b.path("sender").path("email").asText());
        assertEquals("Demo Sender", b.path("sender").path("name").asText());
        assertEquals("Your vehicle offer is ready", b.path("subject").asText());
        assertTrue(b.path("textContent").asText().contains(LINK));
        assertTrue(b.path("htmlContent").asText().contains(LINK));
        assertEquals(op("idempotency_key"), b.path("headers").path("idempotencyKey").asText());
        assertEquals("acknowledged", op("state"));
        assertEquals("<abc.123@example.test>", op("provider_reference"));
        assertEquals("configured", transport.name());
    }

    @Test
    void secondSendAfterAcknowledgementMakesNoCall() throws Exception {
        stub.then(BrevoStub.created("msg-1"));
        assertFalse(transport.alreadyAccepted(f.ctx(), EVENT));
        send();
        assertTrue(transport.alreadyAccepted(f.ctx(), EVENT));
        assertInstanceOf(MailTransport.Accepted.class, send());
        assertEquals(1, stub.requests.size());
    }

    @Test
    void custodyKeepsKeyAndRecipientAcrossRetries() throws Exception {
        stub.then(BrevoStub.reply(500, "{}")).then(BrevoStub.created("msg-2"));
        assertEquals(new MailTransport.Failed("provider-unavailable", true), send());
        assertEquals("pending", op("state"));
        setEmail("emp-1", "changed@example.test");
        assertInstanceOf(MailTransport.Accepted.class, transport.send(f.ctx(), new DeliveryAttempt(EVENT, 2, "emp-1"),
                message(LINK)));
        assertEquals(2, stub.requests.size());
        assertEquals(body(0).path("headers").path("idempotencyKey").asText(),
                body(1).path("headers").path("idempotencyKey").asText());
        assertEquals("alex@example.test", body(1).path("to").path(0).path("email").asText());
    }

    @Test
    void authenticationRefusesTheOperationForGood() throws Exception {
        stub.then(BrevoStub.reply(401, "{}"));
        assertEquals(new MailTransport.Failed("provider-authentication", false), send());
        assertEquals("refused", op("state"));
        assertEquals(new MailTransport.Failed("provider-rejected", false), send());
        assertEquals(1, stub.requests.size());
    }

    @Test
    void providerReplyClassification() throws Exception {
        record Case(BrevoStub.Reply reply, String code, boolean retryable) {}
        List<Case> cases = List.of(
                new Case(BrevoStub.reply(429, "{}"), "provider-rate-limited", true),
                new Case(BrevoStub.reply(400, "{\"message\":\"bad\"}"), "provider-rejected", false),
                new Case(BrevoStub.reply(403, "{}"), "provider-authentication", false),
                new Case(BrevoStub.reply(408, ""), "provider-unavailable", true),
                new Case(BrevoStub.reply(503, ""), "provider-unavailable", true),
                new Case(BrevoStub.reply(202, "{\"messageId\":\"x1\"}"), "provider-unconfirmed", true),
                new Case(BrevoStub.reply(201, "{}"), "provider-unconfirmed", true),
                new Case(BrevoStub.reply(201, "not json"), "provider-unconfirmed", true),
                new Case(BrevoStub.reply(400, "{\"code\":\"duplicate_parameter\"}"), "provider-unconfirmed", true),
                new Case(BrevoStub.created("alex@example.test"), "provider-unconfirmed", true),
                new Case(BrevoStub.created("sender@example.test"), "provider-unconfirmed", true),
                new Case(BrevoStub.created("bad id with spaces"), "provider-unconfirmed", true),
                new Case(BrevoStub.created(KEY), "provider-unconfirmed", true));
        int n = 0;
        for (Case c : cases) {
            stub.script.clear();
            stub.requests.clear();
            stub.then(c.reply());
            DeliveryAttempt own = new DeliveryAttempt("event-" + n++, 1, "emp-1");
            assertEquals(new MailTransport.Failed(c.code(), c.retryable()), transport.send(f.ctx(), own, message(LINK)),
                    c.reply().toString());
        }
    }

    @Test
    void messageIdContainingTheIdempotencyKeyIsNotConfirmed() throws Exception {
        stub.then(BrevoStub.reply(500, "{}"));
        send();
        String key = op("idempotency_key");
        stub.script.clear();
        stub.then(BrevoStub.created("id-" + key));
        assertEquals(new MailTransport.Failed("provider-unconfirmed", true),
                transport.send(f.ctx(), new DeliveryAttempt(EVENT, 2, "emp-1"), message(LINK)));
    }

    @Test
    void redirectIsNotFollowed() throws Exception {
        stub.then(new BrevoStub.Reply(302, "", 0, stub.other().toString()));
        assertEquals(new MailTransport.Failed("provider-unavailable", true), send());
        assertEquals(1, stub.requests.size());
        assertTrue(stub.requests.stream().noneMatch(r -> r.path().equals("/elsewhere")));
    }

    @Test
    void slowProviderTimesOutAsRetryable() throws Exception {
        stub.then(new BrevoStub.Reply(201, "{\"messageId\":\"late\"}", 2000, null));
        assertEquals(new MailTransport.Failed("provider-timeout", true), send());
        assertEquals("pending", op("state"));
    }

    @Test
    void windowExpiryStopsBeforeAnyCall() throws Exception {
        stub.then(BrevoStub.reply(500, "{}"));
        send();
        clock.advance(31 * 60);
        assertEquals(new MailTransport.Failed("provider-window-expired", false),
                transport.send(f.ctx(), new DeliveryAttempt(EVENT, 2, "emp-1"), message(LINK)));
        assertEquals(1, stub.requests.size());
    }

    @Test
    void windowBoundaryAndClockSkew() throws Exception {
        stub.then(BrevoStub.reply(500, "{}"));
        send();
        clock.advance(30 * 60 - 1);
        assertEquals(new MailTransport.Failed("provider-unavailable", true),
                transport.send(f.ctx(), new DeliveryAttempt(EVENT, 2, "emp-1"), message(LINK)));
        clock.advance(1);
        assertEquals(new MailTransport.Failed("provider-window-expired", false),
                transport.send(f.ctx(), new DeliveryAttempt(EVENT, 3, "emp-1"), message(LINK)));
        clock.now = NotifyFixture.T0.minusSeconds(5);
        assertEquals(new MailTransport.Failed("provider-window-expired", false),
                transport.send(f.ctx(), new DeliveryAttempt(EVENT, 4, "emp-1"), message(LINK)));
        assertEquals(2, stub.requests.size());
    }

    @Test
    void missingOrInvalidRecipientMakesNoCustodyAndNoCall() throws Exception {
        MailTransport.Result expected = new MailTransport.Failed("recipient-email-invalid", false);
        assertEquals(expected, transport.send(f.ctx(), new DeliveryAttempt(EVENT, 1, "emp-2"), message(LINK)));
        setEmail("emp-2", "not an email");
        assertEquals(expected, transport.send(f.ctx(), new DeliveryAttempt(EVENT, 1, "emp-2"), message(LINK)));
        f.update("UPDATE notification_recipients SET delivery_email = NULL WHERE employee_id = 'emp-2'");
        assertEquals(expected, transport.send(f.ctx(), new DeliveryAttempt(EVENT, 1, "emp-2"), message(LINK)));
        assertEquals(0, f.count("SELECT count(*) FROM pending_operations"));
        assertEquals(0, stub.requests.size());
    }

    @Test
    void relativeOrForeignOfferLinkMakesNoCall() throws Exception {
        MailTransport.Result expected = new MailTransport.Failed("offer-link-invalid", false);
        for (String link : new String[] {"/gcsp/offers/off-1", "https://other.example/gcsp/offers/off-1",
            "http://demo.example/gcsp/offers/off-1", "https://demo.example/other/off-1",
            "https://demo.example/gcsp/offers/off-1?x=1", "https://demo.example/gcsp/offers/off-1#frag",
            "https://user@demo.example/gcsp/offers/off-1", "https://demo.example.evil.test/gcsp/offers/off-1"}) {
            assertEquals(expected, transport.send(f.ctx(), attempt, message(link)), link);
        }
        assertEquals(0, f.count("SELECT count(*) FROM pending_operations"));
        assertEquals(0, stub.requests.size());
    }

    @Test
    void retiredRunIsStaleAndMakesNoCall() throws Exception {
        f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-1'");
        assertInstanceOf(MailTransport.StaleRun.class, send());
        assertEquals(0, stub.requests.size());
    }

    @Test
    void duplicateCustodyFromAnotherInstanceIsReused() throws Exception {
        stub.then(BrevoStub.reply(500, "{}")).then(BrevoStub.created("msg-3"));
        send();
        BrevoTransport second = transport(stub.endpoint());
        assertInstanceOf(MailTransport.Accepted.class, second.send(f.ctx(), new DeliveryAttempt(EVENT, 2, "emp-1"),
                message(LINK)));
        assertEquals(1, f.count("SELECT count(*) FROM pending_operations"));
    }

    @Test
    void unreachableDatabaseOrProviderIsRetryable() throws Exception {
        stub.close();
        assertEquals(new MailTransport.Failed("provider-unavailable", true), send());
    }

    @Test
    void noTextColumnHoldsTheApiKey() throws Exception {
        stub.then(BrevoStub.reply(401, "{\"message\":\"" + KEY + "\"}"));
        send();
        stub.script.clear();
        stub.then(BrevoStub.created("msg-4"));
        transport.send(f.ctx(), new DeliveryAttempt("event-2", 1, "emp-1"), message(LINK));
        assertNotEquals(KEY, f.text("SELECT provider_reference FROM pending_operations WHERE operation_id = 'mail:event-2'"));
        assertFalse(dump().contains(KEY));
        assertFalse(new BrevoSettings(KEY, "a@example.test", "n", java.net.URI.create("https://demo.example/"),
                stub.endpoint(), Duration.ofSeconds(1)).toString().contains(KEY));
    }

    /** Every table's rows as text, like PgFixture.stateDigest. */
    String dump() throws SQLException {
        List<String> tables = new ArrayList<>();
        try (Connection c = f.pool().getConnection(); ResultSet rs = c.createStatement().executeQuery(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = '" + f.schema + "'")) {
            while (rs.next()) tables.add(rs.getString(1));
        }
        StringBuilder all = new StringBuilder();
        for (String t : tables) {
            all.append(f.text("SELECT coalesce(string_agg(x::text, '|'), '') FROM \"" + t + "\" x"));
        }
        return all.toString();
    }
}
