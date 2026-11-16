package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

/** The review-details input rules, reason by reason, as server/gcsp/manual-review/validation.js words them. */
class ReviewValidationTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ReviewValidation.Constraints LIMITS = new ReviewValidation.Constraints(500, 500000, null);

    static ObjectNode command() {
        ObjectNode n = JSON.createObjectNode().put("commandId", "c-1").put("holdId", "h").put("quoteId", "q")
                .put("expectedHoldVersion", 1).put("expectedDraftVersion", 1).put("expectedReviewDetailsVersion", 0);
        n.set("details", details());
        return n;
    }

    static ObjectNode details() {
        ObjectNode d = JSON.createObjectNode();
        d.putObject("contact").put("phone", "01632 960000").put("email", "paula.mason@gcsp-demo.com");
        d.put("expectedReturnMileage", 20000).put("specialRequirements", "Please call first");
        return d;
    }

    private static void command(Consumer<ObjectNode> edit, String field, String reason) {
        ObjectNode c = command();
        edit.accept(c);
        refused(ReviewValidation.validateCommand(c), field, reason);
    }

    private static void details(Consumer<ObjectNode> edit, String mode, String field, String reason) {
        ObjectNode d = details();
        edit.accept(d);
        refused(ReviewValidation.validateDetails(d, mode, LIMITS), field, reason);
    }

    private static void refused(ReviewResult r, String field, String reason) {
        JsonNode body = ((ReviewResult.Body) r).body();
        assertEquals("invalid", body.get("status").asText());
        assertEquals("invalid-review-details", body.get("code").asText());
        assertEquals(field, body.get("reasons").get(0).get("field").asText());
        assertEquals(reason, body.get("reasons").get(0).get("reason").asText());
        assertEquals("validation", body.get("view").get("state").asText());
        assertTrue(body.get("view").get("editable").asBoolean());
        assertEquals("correct-fields", body.get("view").get("action").asText());
    }

    @Test
    void aWellFormedCommandAndDetailsPass() {
        assertNull(ReviewValidation.validateCommand(command()));
        assertNull(ReviewValidation.validateDetails(details(), "replacement", LIMITS));
        ObjectNode newMode = details();
        newMode.putNull("expectedReturnMileage");
        assertNull(ReviewValidation.validateDetails(newMode, "new", LIMITS));
    }

    @Test
    void commandShapeAndIdentifierReasons() {
        command(c -> c.put("extra", 1), "command", "Use only the documented review fields.");
        for (String f : new String[] {"commandId", "holdId", "quoteId"}) {
            command(c -> c.remove(f), f, "Supply a nonempty identifier of at most 100 characters.");
            command(c -> c.put(f, "   "), f, "Supply a nonempty identifier of at most 100 characters.");
            command(c -> c.put(f, "x".repeat(101)), f, "Supply a nonempty identifier of at most 100 characters.");
            command(c -> c.put(f, 5), f, "Supply a nonempty identifier of at most 100 characters.");
        }
        assertNull(ReviewValidation.validateCommand(withId("x".repeat(100))));
    }

    private static ObjectNode withId(String id) {
        return command().put("commandId", id);
    }

    @Test
    void revisionReasons() {
        for (String f : new String[] {"expectedHoldVersion", "expectedDraftVersion"}) {
            command(c -> c.put(f, 0), f, "Supply the current integer revision.");
            command(c -> c.put(f, -1), f, "Supply the current integer revision.");
            command(c -> c.put(f, 1.5), f, "Supply the current integer revision.");
            command(c -> c.put(f, "1"), f, "Supply the current integer revision.");
        }
        command(c -> c.put("expectedReviewDetailsVersion", -1), "expectedReviewDetailsVersion", "Supply the current integer revision.");
        command(c -> c.remove("expectedReviewDetailsVersion"), "expectedReviewDetailsVersion", "Supply the current integer revision.");
        command(c -> c.put("expectedHoldVersion", 9_007_199_254_740_992L), "expectedHoldVersion", "Supply the current integer revision.");
        assertNull(ReviewValidation.validateCommand(command().put("expectedReviewDetailsVersion", 7)));
        assertNull(ReviewValidation.validateCommand(command().put("expectedHoldVersion", 2.0)), "5.0 is a safe integer in JS");
    }

    @Test
    void detailShapeAndContactReasons() {
        details(d -> d.put("extra", 1), "replacement", "details", "Use only the documented detail fields.");
        details(d -> d.remove("contact"), "replacement", "contact", "Supply only phone and email.");
        details(d -> ((ObjectNode) d.get("contact")).put("fax", "1"), "replacement", "contact", "Supply only phone and email.");
        details(d -> ((ObjectNode) d.get("contact")).put("phone", "12345"), "replacement", "contact.phone", "Supply a contact telephone.");
        details(d -> ((ObjectNode) d.get("contact")).put("phone", "abc 1234567"), "replacement", "contact.phone", "Supply a contact telephone.");
        details(d -> ((ObjectNode) d.get("contact")).put("phone", 1632960000L), "replacement", "contact.phone", "Supply a contact telephone.");
        details(d -> ((ObjectNode) d.get("contact")).put("email", "nobody"), "replacement", "contact.email", "Supply a contact email address.");
        details(d -> ((ObjectNode) d.get("contact")).put("email", "a b@c.d"), "replacement", "contact.email", "Supply a contact email address.");
        details(d -> ((ObjectNode) d.get("contact")).put("email", "a".repeat(250) + "@b.cd"), "replacement", "contact.email",
                "Supply a contact email address.");
    }

    @Test
    void mileageReasonsDependOnTheMode() {
        String need = "Supply returning-car mileage from 0 to 500000 miles.";
        details(d -> d.remove("expectedReturnMileage"), "replacement", "expectedReturnMileage", need);
        details(d -> d.putNull("expectedReturnMileage"), "replacement", "expectedReturnMileage", need);
        details(d -> d.put("expectedReturnMileage", -1), "replacement", "expectedReturnMileage", need);
        details(d -> d.put("expectedReturnMileage", 500001), "replacement", "expectedReturnMileage", need);
        details(d -> d.put("expectedReturnMileage", 1.5), "replacement", "expectedReturnMileage", need);
        details(d -> d.put("expectedReturnMileage", "5"), "replacement", "expectedReturnMileage", need);
        details(d -> d.put("expectedReturnMileage", 100), "new", "expectedReturnMileage",
                "Returning-car mileage applies only to a replacement.");
        assertNull(ReviewValidation.validateDetails(details().put("expectedReturnMileage", 0), "replacement", LIMITS));
        assertNull(ReviewValidation.validateDetails(details().put("expectedReturnMileage", 500000), "replacement", LIMITS));
    }

    @Test
    void specialRequirementsReasons() {
        String text = "Use at most 500 characters. Requests do not change released stock.";
        details(d -> d.remove("specialRequirements"), "replacement", "specialRequirements", text);
        details(d -> d.put("specialRequirements", 5), "replacement", "specialRequirements", text);
        details(d -> d.put("specialRequirements", "x".repeat(501)), "replacement", "specialRequirements", text);
        details(d -> d.put("specialRequirements", "bad\u0001char"), "replacement", "specialRequirements", text);
        assertNull(ReviewValidation.validateDetails(details().put("specialRequirements", "x".repeat(500)), "replacement", LIMITS));
        assertNull(ReviewValidation.validateDetails(details().put("specialRequirements", "line\nbreak\ttab"), "replacement", LIMITS),
                "newline, tab and carriage return are allowed");
        // UTF-16 code units: 250 emoji are 500 units, 251 are over.
        assertNull(ReviewValidation.validateDetails(details().put("specialRequirements", "😀".repeat(250)), "replacement", LIMITS));
        details(d -> d.put("specialRequirements", "😀".repeat(251)), "replacement", "specialRequirements", text);
    }

    @Test
    void safeDetailsKeepsOnlyTheDocumentedFields() {
        ObjectNode d = details();
        d.putNull("expectedReturnMileage");
        JsonNode safe = ReviewValidation.safeDetails(d);
        assertEquals("01632 960000", safe.get("contact").get("phone").asText());
        assertTrue(safe.get("expectedReturnMileage").isNull());
        ObjectNode absent = details();
        absent.remove("expectedReturnMileage");
        assertTrue(ReviewValidation.safeDetails(absent).get("expectedReturnMileage").isNull());
        assertFalse(safe.has("extra"));
    }

    @Test
    void instantsAndDaysFollowNodesRules() {
        assertTrue(ReviewValidation.validInstant("2026-11-05T09:00:00.000Z"));
        assertTrue(ReviewValidation.validInstant("2026-11-05T09:00:00+01:00"));
        assertFalse(ReviewValidation.validInstant("2026-02-30T09:00:00Z"));
        assertFalse(ReviewValidation.validInstant("2026-11-05T24:00:00Z"));
        assertFalse(ReviewValidation.validInstant("2026-11-05"));
        assertTrue(ReviewValidation.validDay("2026-11-05"));
        assertFalse(ReviewValidation.validDay("05/11/2026"));
    }

    @Test
    void theViewsOfEachRefusalAreNodeShaped() {
        JsonNode unavailable = ((ReviewResult.Body) ReviewResult.unavailable("policy")).body();
        assertEquals("manual-review-source-unavailable", unavailable.get("code").asText());
        assertEquals("policy", unavailable.get("source").asText());
        assertTrue(unavailable.get("retryable").asBoolean());
        assertEquals("scheme-support", unavailable.get("view").get("supportOwner").asText());
        JsonNode conflict = ((ReviewResult.Body) ReviewResult.conflict("claim-expired")).body();
        assertEquals("refresh-review", conflict.get("view").get("action").asText());
        JsonNode stale = ((ReviewResult.Body) ReviewResult.stale("review-details", 1, 2)).body();
        assertEquals("stale-version", stale.get("status").asText());
        assertEquals("stale-review-details", stale.get("code").asText());
        assertEquals(1, stale.get("expectedVersion").asInt());
        assertEquals(2, stale.get("currentVersion").asInt());
    }
}
