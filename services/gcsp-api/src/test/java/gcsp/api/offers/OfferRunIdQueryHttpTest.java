package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySeed.PAULA;
import static gcsp.api.allocation.BuddyJourneySeed.RUN;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.allocation.BuddyJourneySupport.post;
import static gcsp.api.offers.OfferDecisionJourneySupport.body;
import static gcsp.api.offers.OfferDecisionJourneySupport.path;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** FUCQ-519: the emailed link's ?runId= reads (Angular offer.client.ts) work through the started app, as Node's do. */
@QuarkusTest
@TestProfile(OfferJourneyProfiles.RunIdQuery.class)
class OfferRunIdQueryHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    OfferRecords records;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @BeforeEach
    void useTheRunClockForDocuments() {
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
    }

    private static JsonNode refused(String token, String url, int status, String code) throws Exception {
        var r = get(token, url);
        assertEquals(status, r.statusCode(), r.asString());
        JsonNode b = body(r);
        assertEquals(code, b.path("code").asText(), b.toString());
        return b;
    }

    @Test
    void theRunIdSelectorIsHonouredOnOfferReadsAndRefusedElsewhere() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        assertTrue(ClientProxy.unwrap(records) instanceof PostgresOfferRecords);
        String id = OfferDecisionJourneySupport.allocate(s, presenter, PAULA);
        String offer = path(id);

        // Active run: same value as the bare read, apart from serverNow.
        JsonNode bare = body(get(paula, offer).then().statusCode(200).extract().response()).get("value").deepCopy();
        JsonNode withRun = body(get(paula, offer + "?runId=" + RUN).then().statusCode(200).extract().response())
                .get("value").deepCopy();
        ((ObjectNode) bare).remove("serverNow");
        ((ObjectNode) withRun).remove("serverNow");
        assertEquals(bare, withRun);
        assertEquals(id, withRun.get("offerId").asText());

        JsonNode reasons = body(get(paula, offer + "/decision-reasons?runId=" + RUN).then().statusCode(200).extract()
                .response()).get("value");
        assertEquals(1, reasons.get("schemaVersion").asInt());
        assertEquals("offer.declineReasons.v1", reasons.get("key").asText());
        assertFalse(reasons.get("reasons").isEmpty());
        for (String f : new String[] {"status", "basis", "source", "sourceDate"}) {
            assertTrue(reasons.path("provenance").has(f), "provenance." + f);
        }

        // Another run is stale on both reads, as Node answers.
        for (String u : new String[] {offer, offer + "/decision-reasons"}) {
            assertEquals("stale-run", refused(paula, u + "?runId=run-earlier", 409, "offer-from-earlier-run").get("status").asText());
            refused(paula, u + "?runId=" + RUN + "&x=1", 400, "unsupported-query");
            refused(paula, u + "?x=1", 400, "unsupported-query");
            refused(paula, u + "?runId=a&runId=b", 400, "unsupported-query");
            refused(paula, u + "?runId=", 400, "invalid-offer-selector");
        }

        // Unknown offer with the active run is a plain not-found; writes and /current keep refusing queries.
        refused(paula, path("buddy-offer:" + "9".repeat(64)) + "?runId=" + RUN, 404, "offer-not-found");
        var decision = post(paula, offer + "/decision?runId=" + RUN, "{}");
        assertEquals(400, decision.statusCode(), decision.asString());
        assertEquals("unsupported-query", body(decision).path("code").asText());
        refused(paula, gcsp.api.allocation.BuddyJourneySupport.API + "/offers/current?runId=" + RUN, 400, "unsupported-query");
    }
}
