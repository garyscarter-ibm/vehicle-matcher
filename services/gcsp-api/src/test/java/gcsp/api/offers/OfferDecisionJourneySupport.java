package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySupport.API;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.allocation.BuddyJourneySupport.post;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySupport;
import io.restassured.response.Response;

/** Request bodies and typed reads shared by the started-app offer decision journeys. */
final class OfferDecisionJourneySupport {

    private OfferDecisionJourneySupport() {}

    static String path(String offerId) {
        return API + "/offers/" + offerId;
    }

    static JsonNode body(Response r) throws Exception {
        return BuddyJourneySupport.JSON.readTree(r.asString());
    }

    /** The offer view's value for the owner. */
    static JsonNode view(String token, String offerId) throws Exception {
        return body(get(token, path(offerId)).then().statusCode(200).extract().response()).get("value");
    }

    static String termsDigest(String token) throws Exception {
        JsonNode terms = body(get(token, API + "/manual/order/terms").then().statusCode(200).extract().response());
        String digest = terms.path("value").path("termsDigest").asText(null);
        assertNotNull(digest, terms.toString());
        return digest;
    }

    static ObjectNode accept(String commandId, JsonNode view, String termsDigest) {
        ObjectNode b = base(commandId, "accept", view);
        b.put("termsDigest", termsDigest);
        b.putObject("declarations").put("terms", true).put("driver", true).put("return", true);
        b.put("expectedReturnMileage", 5400);
        return b;
    }

    static ObjectNode decline(String commandId, JsonNode view, String reasonCode) {
        ObjectNode b = base(commandId, "decline", view);
        b.put("reasonCode", reasonCode);
        return b;
    }

    private static ObjectNode base(String commandId, String decision, JsonNode view) {
        ObjectNode b = BuddyJourneySupport.JSON.createObjectNode();
        b.put("commandId", commandId);
        b.put("decision", decision);
        b.put("runId", view.path("runId").asText());
        b.put("expectedQuoteVersion", view.path("quote").path("revisions").path("quote").asLong());
        b.put("expectedOfferVersion", view.get("offerVersion").asLong());
        b.put("expectedHoldVersion", view.get("holdVersion").asLong());
        return b;
    }

    /** Posts a decision and asserts the status, failing with the whole body so a refusal explains itself. */
    static JsonNode decide(String token, String offerId, ObjectNode body, int status) throws Exception {
        Response r = post(token, path(offerId) + "/decision", body.toString());
        assertEquals(status, r.statusCode(), r.asString());
        return body(r);
    }

    /** One presenter tick that releases the cars and allocates real offers; returns the offer id for each employee. */
    static String allocate(BuddyJourneySupport s, String presenter, String employeeId) throws Exception {
        if (s.count("SELECT count(*) FROM buddy_offers") == 0) {
            assertEquals("completed", s.tick(presenter, "offer-journey-allocate").get("state").asText());
        }
        return s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", employeeId);
    }

    /** Row counts of every table a decision may write; equal before and after means nothing was written. */
    static String written(BuddyJourneySupport s) throws Exception {
        return s.text("SELECT concat_ws('/', (SELECT count(*) FROM offer_decisions), (SELECT count(*) FROM selection_orders), "
                + "(SELECT count(*) FROM pending_operations), (SELECT count(*) FROM outbox_events), "
                + "(SELECT count(*) FROM custody_holds WHERE state <> 'active'), "
                + "(SELECT count(*) FROM buddy_offers WHERE state <> 'active'), "
                + "(SELECT count(*) FROM stock_cars WHERE state = 'allocated'))");
    }
}
