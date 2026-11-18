package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySupport.API;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.allocation.BuddyJourneySupport.post;
import static gcsp.api.offers.OfferDecisionJourneySupport.accept;
import static gcsp.api.offers.OfferDecisionJourneySupport.body;
import static gcsp.api.offers.OfferDecisionJourneySupport.decide;
import static gcsp.api.offers.OfferDecisionJourneySupport.termsDigest;
import static gcsp.api.offers.OfferDecisionJourneySupport.view;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import gcsp.api.ordering.HttpOrderingProvider;
import gcsp.api.ordering.OrderingProviderBindings;
import gcsp.api.ordering.OrderingServiceHolder;
import gcsp.api.scenario.ScenarioWiring;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * FUCQ-481 AC2: a demo-prepared employee gets a Buddy claim from the selected candidates and accounts, signs in with an
 * RS256 JWT, accepts over HTTP, and the owner's order read is acknowledged once by the real remote ordering provider.
 */
@QuarkusTest
@TestProfile(DemoScenarioRemoteOrderingProfile.class)
class DemoScenarioRemoteOrderingHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String EMPLOYEE = "employee-paula";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "gcsp.ordering.reconcile-url")
    String orderingReconcileUrl;

    @ConfigProperty(name = "gcsp.scenario.provider")
    String scenarioProvider;

    @ConfigProperty(name = "gcsp.allocation.candidates.provider")
    String candidatesProvider;

    @ConfigProperty(name = "gcsp.account.provider")
    String accountProvider;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @Inject
    ScenarioWiring scenario;

    @Inject
    OrderingServiceHolder ordering;

    @Inject
    OrderingProviderBindings bindings;

    @BeforeEach
    void useTheRunClockForDocuments() {
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
    }

    @Test
    void demoPreparedEmployeeClaimSignedInAcceptAndOrderAreCoherentOverRemoteOrdering() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);

        // The selected composition: demo preparation, recommendation candidates, repository accounts, real remote ordering.
        assertEquals("demo", scenarioProvider);
        assertEquals("recommendation", candidatesProvider);
        assertEquals("repository", accountProvider);
        assertTrue(scenario.demo());
        assertEquals("remote", ordering.provider());
        assertEquals("remote", bindings.mode());
        assertInstanceOf(HttpOrderingProvider.class, bindings.provider(dataSource));
        assertEquals(0, stats().path("executes").asInt(), "startup made no ordering request");

        // Demo preparation made the employee, the account record and the slot; the test seeded none of them.
        assertEquals(1, s.count("SELECT count(*) FROM scenario_runs WHERE run_id = 'run-1' AND state = 'prepared'"));
        assertEquals("Paula Mason", s.text("SELECT attributes->>'name' FROM employees WHERE employee_id = ?", EMPLOYEE));
        assertEquals(1, s.count("SELECT count(*) FROM employee_account_records WHERE employee_id = ?", EMPLOYEE));
        assertEquals(1, s.count("SELECT count(*) FROM entitlement_slots WHERE employee_id = ? AND slot_id = 'slot-paula'", EMPLOYEE));
        assertEquals(0, s.count("SELECT count(*) FROM briefs"), "no brief exists before the owner confirms one");

        // The owner signs in and engages Buddy through the real brief routes; then the presenter's tick claims for her.
        String paula = s.token("sub-paula", "employee");
        String presenter = s.token("sub-presenter", "presenter");
        confirmBrief(paula);
        JsonNode tick = s.tick(presenter, "fucq481-allocate");
        assertEquals("completed", tick.path("state").asText());
        String offerId = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", EMPLOYEE);
        String holdId = s.text("SELECT hold_id FROM buddy_offers WHERE offer_id = ?", offerId);
        String orderUuid = s.text("SELECT order_uuid FROM buddy_offers WHERE offer_id = ?", offerId);
        assertTrue(s.count("SELECT count(*) FROM allocation_evaluations, jsonb_array_elements(evaluation->'decisions') d "
                + "WHERE employee_id = ? AND d->>'orderUuid' = ? AND d->>'gateStatus' = 'eligible'", EMPLOYEE, orderUuid) > 0,
                "the claim came from the selected candidates' eligible decision for the demo-prepared employee");
        assertEquals(0, s.count("SELECT count(*) FROM selection_orders"));

        // Signed-in decision: the owner reads the offer and accepts it over HTTP.
        JsonNode offer = view(paula, offerId);
        assertEquals("pending", offer.path("state").asText());
        String digest = termsDigest(paula);
        JsonNode decided = decide(paula, offerId, accept("fucq481-accept-1", offer, digest), 200);
        assertEquals("accepted", decided.path("value").path("state").asText(), decided.toString());
        assertEquals("accepted", view(paula, offerId).path("state").asText());
        assertEquals(1, s.count("SELECT count(*) FROM selection_orders WHERE employee_id = ? AND order_uuid = ? "
                + "AND source_type = 'buddy-offer' AND hold_id = ?", EMPLOYEE, orderUuid, holdId));
        String selection = s.text("SELECT operation_id FROM selection_orders WHERE hold_id = ?", holdId);
        assertTrue(stats().path("executes").asInt() <= 1, "the decision drives at most one execute");

        // The owner's order read is acknowledged through the real provider; a repeat never executes again.
        String order = API + "/manual/order";
        JsonNode read = body(get(paula, order).then().statusCode(200).extract().response());
        assertEquals("ok", read.path("status").asText(), read.toString());
        assertEquals("acknowledged", read.path("value").path("status").asText());
        assertEquals(holdId, read.path("value").path("selection").path("holdId").asText());
        String reference = stats().path("references").path(selection).asText();
        assertTrue(reference.endsWith(selection), reference);
        assertEquals(reference, read.path("value").path("providerReference").asText());
        assertEquals(1, stats().path("executes").asInt(), "the owner's read leaves exactly one remote execute");
        JsonNode again = body(get(paula, order).then().statusCode(200).extract().response());
        assertEquals("acknowledged", again.path("value").path("status").asText());
        assertEquals(reference, again.path("value").path("providerReference").asText());
        assertEquals(1, stats().path("executes").asInt(), "a repeated owner read never executes again");
        assertEquals(1, stats().path("effects").asInt());
        assertEquals(0, stats().path("duplicates").asInt());

        assertEquals(1, s.count("SELECT count(*) FROM pending_operations WHERE operation_id = ? AND operation_type = "
                + "'selection-order' AND state = 'acknowledged' AND provider_reference = ?", selection, reference));
        assertEquals(1, s.count("SELECT count(*) FROM custody_holds WHERE hold_id = ? AND state = 'allocated'", holdId));
        assertEquals("allocated", s.text("SELECT state FROM stock_cars WHERE order_uuid = ?", orderUuid));
        assertEquals(1, s.count("SELECT count(*) FROM selection_orders"));
        s.assertCustodyInvariants(1);
    }

    /** The employee's brief through the real routes: three categories and Same again, then confirm with consent. */
    private static void confirmBrief(String token) throws Exception {
        JsonNode initial = body(get(token, API + "/brief/editor").then().statusCode(200).extract().response())
                .at("/value/initial");
        String prefs = post(token, API + "/brief/preferences", "{\"commandId\":\"" + cmd() + "\",\"expectedBriefVersion\":"
                + initial.get("briefVersion") + ",\"expectedDraftVersion\":" + initial.get("draftVersion") + ",\"changes\":{"
                + "\"comfort\":{\"value\":50},\"body\":{\"value\":[\"estate\"]},\"sportiness\":{\"value\":50}}}").then().statusCode(200).extract().asString();
        long draft = JSON.readTree(prefs).at("/value/draftVersion").asLong();
        JsonNode confirmed = body(post(token, API + "/brief/confirm", "{\"commandId\":\"" + cmd()
                + "\",\"expectedBriefVersion\":" + initial.get("briefVersion") + ",\"expectedDraftVersion\":" + draft
                + ",\"consent\":{\"search\":true,\"hold\":true}}").then().statusCode(200).extract().response());
        assertEquals(1, confirmed.at("/value/brief/briefVersion").asInt(), confirmed.toString());
        assertNotNull(confirmed.at("/value/brief"));
    }

    private static String cmd() {
        return "fucq481-" + UUID.randomUUID();
    }

    private JsonNode stats() throws Exception {
        URI uri = URI.create(orderingReconcileUrl.replace("/ordering/reconcile", "/ordering/stats"));
        try (HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            HttpResponse<String> r = client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(2)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            assertEquals(200, r.statusCode());
            return JSON.readTree(r.body());
        }
    }
}
