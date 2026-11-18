package gcsp.api.notify;

import static gcsp.api.allocation.BuddyJourneySeed.BRUNO;
import static gcsp.api.allocation.BuddyJourneySeed.CARLA;
import static gcsp.api.allocation.BuddyJourneySeed.PAULA;
import static gcsp.api.allocation.BuddyJourneySupport.API;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.allocation.BuddyJourneySupport.post;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.WorkResult;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/** FUCQ-469 through the started app: a real allocation writes the intent, Brevo (a loopback stub) delivers it. */
@QuarkusTest
@TestProfile(NotificationJourneyProfile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class NotificationJourneyHttpTest {

    private static final String BASE = "https://gcsp.example.test";
    private static final String PAULA_EMAIL = "paula.journey@example.test";
    private static final String BRUNO_EMAIL = "bruno.journey@example.test";
    private static final Pattern LINK = Pattern.compile("Review your offer: (\\S+)");

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    Notifications notifications;

    private BuddyJourneySupport support() {
        return new BuddyJourneySupport(dataSource, signingJwk);
    }

    private static String setEmail(String token, String id, String email) {
        return post(token, API + "/manual/notification-email", "{\"commandId\":\"" + id
                + "\",\"expectedVersion\":0,\"deliveryEmail\":\"" + email + "\"}").then().statusCode(200).extract().asString();
    }

    @Test
    @Order(1)
    void aBuddyOfferWritesItsIntentWithTheAllocationAndARolledBackChangeWritesNone() throws Exception {
        BuddyJourneySupport s = support();
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        String bruno = s.token("sub-bruno", "employee");
        BrevoStub stub = NotificationJourneyProfile.StubResource.stub;
        stub.then(BrevoStub.reply(429, "{}")).then(BrevoStub.created("<m1@example.test>"))
                .then(BrevoStub.reply(503, "{}")).then(BrevoStub.created("<m2@example.test>"))
                .then(BrevoStub.created("<m3@example.test>"));

        // Each employee sets their own address; the presenter cannot act as the employee.
        setEmail(paula, "journey-email-paula", PAULA_EMAIL);
        setEmail(bruno, "journey-email-bruno", BRUNO_EMAIL);
        post(presenter, API + "/manual/notification-email", "{\"commandId\":\"p\",\"expectedVersion\":0,"
                + "\"deliveryEmail\":\"presenter@example.test\"}").then().statusCode(403);
        assertEquals(0, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));

        // The tick allocates; its outbox-dispatch stage is the deployed delivery path.
        JsonNode tick = s.tick(presenter, "notify-journey-1");
        assertEquals("completed", tick.get("state").asText());
        assertEquals(1, BuddyJourneySupport.outcome(tick, "buddy-allocation").get("value").get("allocations").asInt());
        assertEquals("ok", BuddyJourneySupport.outcome(tick, "captured-outbox").get("status").asText());

        String paulaOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", PAULA);
        String brunoOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", BRUNO);
        assertEquals(2, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));
        for (String[] offer : new String[][] {{PAULA, paulaOffer}, {BRUNO, brunoOffer}}) {
            JsonNode intent = s.json("SELECT payload::text FROM outbox_events WHERE event_id = ?",
                    "notification:offer:" + offer[1] + ":v1");
            assertEquals(offer[0], intent.get("recipientEmployeeId").asText());
            assertEquals(offer[1], intent.get("offerId").asText());
            assertEquals("/gcsp/offers/" + NotificationIntent.segment(offer[1]), intent.get("offerLink").asText());
        }
        assertEquals(0, s.count("SELECT count(*) FROM outbox_events WHERE payload->>'recipientEmployeeId' = ?", CARLA));

        // A change that emits an intent and is then refused rolls back with it: no outbox row.
        RunContext scope = notifications.scope("journey-rollback");
        Outcome refused = notifications.runner().execute(scope,
                new Command("journey.rollback", "journey-rollback-1", BuddyJourneySupport.JSON.createObjectNode()), tx -> {
                    tx.write("UPDATE employees SET version = version + 1 WHERE environment_id = ? AND run_id = ? "
                            + "AND employee_id = ?", scope.environmentId(), scope.runId(), PAULA);
                    NotificationIntent.offer(tx, "offer-rolled-back", PAULA);
                    return WorkResult.refuse("journey-refused", "Refused after the intent was queued.");
                });
        assertTrue(refused instanceof Outcome.Refused, refused.toString());
        assertEquals(0, s.count("SELECT count(*) FROM outbox_events WHERE event_id = ?",
                "notification:offer:offer-rolled-back:v1"));

        // The presenter reads capture and status, and cannot open an employee's offer.
        JsonNode outbox = BuddyJourneySupport.value(get(presenter, API + "/presenter/outbox"), 200).get("value");
        assertEquals(2, outbox.get("messages").size());
        for (JsonNode m : outbox.get("messages")) {
            String employee = m.get("recipient").get("employeeId").asText();
            String offer = PAULA.equals(employee) ? paulaOffer : brunoOffer;
            assertEquals(BASE + "/gcsp/offers/" + NotificationIntent.segment(offer), m.get("offerLink").asText());
            assertFalse(m.toString().contains("@example"), "the presenter view never carries an address");
        }
        get(presenter, API + "/offers/" + paulaOffer).then().statusCode(403);
    }

    @Test
    @Order(2)
    void brevoRetriesWithTheSameKeyEndsSentAndTheEmailedLinkOpensTheOwnersOffer() throws Exception {
        BuddyJourneySupport s = support();
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        String bruno = s.token("sub-bruno", "employee");
        BrevoStub stub = NotificationJourneyProfile.StubResource.stub;

        // The first drain (in order 1) made two requests: a 429 for the first message and a 201 for the second.
        assertEquals(2, stub.requests.size(), "requests so far");
        String retried = to(stub.requests.get(0).body());
        String firstKey = key(stub.requests.get(0).body());
        assertTrue(stub.requests.get(0).path().endsWith("/v3/smtp/email"));
        assertEquals("test-key-not-a-secret", stub.requests.get(0).headers().get("api-key"));
        assertNotNull(firstKey);
        assertTrue(List.of(PAULA_EMAIL, BRUNO_EMAIL).contains(retried));
        org.junit.jupiter.api.Assertions.assertNotEquals(retried, to(stub.requests.get(1).body()));
        assertEquals("retrying", stateOfRecipient(presenter, retried.equals(PAULA_EMAIL) ? PAULA : BRUNO));

        // The retry delay runs on the run clock: advance past it, tick, get a 503, advance again, tick again.
        s.advance(presenter, 120);
        s.tick(presenter, "notify-journey-2");
        assertEquals(3, stub.requests.size());
        assertEquals(retried, to(stub.requests.get(2).body()));
        assertEquals(firstKey, key(stub.requests.get(2).body()), "a retry keeps the idempotency key");
        s.advance(presenter, 240);
        s.tick(presenter, "notify-journey-3");
        assertEquals(4, stub.requests.size());
        assertEquals(firstKey, key(stub.requests.get(3).body()));
        s.advance(presenter, 600);
        s.tick(presenter, "notify-journey-4");
        assertEquals(4, stub.requests.size(), "a sent message is not sent again");

        JsonNode messages = BuddyJourneySupport.value(get(presenter, API + "/presenter/outbox"), 200).get("value")
                .get("messages");
        assertEquals(2, messages.size());
        for (JsonNode m : messages) {
            assertEquals("sent", m.get("state").asText());
            assertEquals("configured", m.get("transport").asText());
        }

        // Follow each emailed link as its owner; another employee is refused.
        for (BrevoStub.Request r : List.of(stub.requests.get(0), stub.requests.get(1))) {
            String recipient = to(r.body());
            Matcher m = LINK.matcher(BuddyJourneySupport.JSON.readTree(r.body()).get("textContent").asText());
            assertTrue(m.find(), r.body());
            URI link = URI.create(m.group(1));
            assertEquals("https", link.getScheme());
            assertEquals("gcsp.example.test", link.getHost());
            String raw = link.getRawPath();
            assertTrue(raw.startsWith("/gcsp/offers/"), raw);
            String offerId = URLDecoder.decode(raw.substring("/gcsp/offers/".length()), StandardCharsets.UTF_8);
            String owner = recipient.equals(PAULA_EMAIL) ? PAULA : BRUNO;
            assertEquals(owner, s.text("SELECT employee_id FROM buddy_offers WHERE offer_id = ?", offerId));
            String ownerToken = owner.equals(PAULA) ? paula : bruno;
            String otherToken = owner.equals(PAULA) ? bruno : paula;
            assertEquals(offerId, BuddyJourneySupport.value(get(ownerToken, API + "/offers/" + offerId), 200)
                    .get("value").get("offerId").asText());
            get(otherToken, API + "/offers/" + offerId).then().statusCode(403);
        }
    }

    private static String to(String body) throws Exception {
        return BuddyJourneySupport.JSON.readTree(body).get("to").get(0).get("email").asText();
    }

    private static String key(String body) throws Exception {
        return BuddyJourneySupport.JSON.readTree(body).get("headers").get("idempotencyKey").asText();
    }

    private static String stateOfRecipient(String presenter, String employeeId) throws Exception {
        JsonNode messages = BuddyJourneySupport.value(get(presenter, API + "/presenter/outbox"), 200).get("value")
                .get("messages");
        for (JsonNode m : messages) {
            if (employeeId.equals(m.get("recipient").get("employeeId").asText())) return m.get("state").asText();
        }
        throw new AssertionError("no message for " + employeeId);
    }
}
