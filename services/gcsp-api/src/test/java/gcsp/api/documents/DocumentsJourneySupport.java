package gcsp.api.documents;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.StockDbFixture;
import gcsp.api.appointments.ReturnJourneySteps;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** The HTTP steps of the documents journey: real RS256 tokens, the real ordering routes and the presenter clock. */
final class DocumentsJourneySupport {

    static final String BASE = "/api/gcsp/v1";
    static final String PRESENTER = BASE + "/presenter";
    private static final String ORDERING = BASE + "/manual/order";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final RsaJsonWebKey key;
    private final AgroalDataSource ds;
    private final Persistence persistence;
    private int seq;

    DocumentsJourneySupport(String signingJwk, AgroalDataSource ds, Persistence persistence) throws Exception {
        this.key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        this.ds = ds;
        this.persistence = persistence;
    }

    // ---- identity and plumbing ----

    private String token(String subject, String role) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(DocumentsTestProfile.ISSUER);
        c.setAudience(DocumentsTestProfile.AUDIENCE);
        c.setSubject(subject);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", DocumentsTestProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    RequestSpecification as(String who) throws Exception {
        String token = switch (who) {
            case "paula" -> token("sub-paula", "employee");
            case "alex" -> token("sub-alex", "employee");
            case "greg" -> token("sub-greg", "greg");
            case "presenter" -> token("sub-presenter", "presenter");
            default -> throw new IllegalArgumentException(who);
        };
        return given().header("Authorization", "Bearer " + token).contentType("application/json");
    }

    static JsonNode body(Response r) throws Exception {
        return JSON.readTree(r.asString());
    }

    static String id() {
        return UUID.randomUUID().toString();
    }

    long count(String sql, Object... params) throws Exception {
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    String text(String sql, Object... params) throws Exception {
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    // ---- ordering: released stock is the only seeded input ----

    void seedStock() throws Exception {
        JsonNode actualAccount = body(as("paula").get(BASE + "/manual/account")).get("value");
        ReturnJourneySteps.prepareCollectionWindows(ds, persistence, actualAccount);
        var run = persistence.guard().currentRun();
        try (Connection c = ds.getConnection()) {
            List<JsonNode> rows = new ArrayList<>(StockDbFixture.rows());
            // Alex's grade is not eligible for the fixture's G21 cars: one more released car of an included model.
            ObjectNode extra = rows.get(0).deepCopy();
            String id = StockDbFixture.UUID_PREFIX + "9";
            extra.put("orderUuid", id).put("orderNumber", "1000009");
            ((ObjectNode) extra.get("facts").get("sourceKeys")).put("stockId", id);
            ((ObjectNode) extra.get("facts").get("facts").get("eligibilityModelKey")).put("value", "U11 X1|20i");
            rows.add(extra);
            StockDbFixture.insertStock(c, run.environmentId(), run.runId(), rows);
        }
    }

    /** The real account, draft, stock, claim, review and ordering routes for a demo employee; returns the order. */
    String placeOrder(String who, String taken) throws Exception {
        JsonNode account = body(as(who).get(BASE + "/manual/account")).get("value");
        assertEquals("ready", account.get("state").asText());
        ObjectNode choices = (ObjectNode) JSON.readTree(StockDbFixture.complete().toString()
                .replace("paula", who).replace("Paula Mason", who));
        String draft = ReturnJourneySteps.withCollectionDate(account, choices).toString();
        Response saved = as(who).body("{\"commandId\":\"draft-" + id() + "\",\"expectedDraftVersion\":0,"
                + "\"expectedContextVersion\":\"" + account.get("contextVersion").asText() + "\",\"choices\":" + draft + "}")
                .post(BASE + "/manual/draft");
        assertEquals(200, saved.statusCode(), saved.asString());
        Response browse = as(who).get(BASE + "/manual/stock");
        assertEquals(200, browse.statusCode(), browse.asString());
        ObjectNode claim = null;
        for (JsonNode d : body(browse).get("value").get("decisions")) {
            if (claim == null && "eligible".equals(d.get("gateStatus").asText()) && !d.get("orderUuid").asText().equals(taken)) {
                claim = ((ObjectNode) d.get("claimInput")).deepCopy();
            }
        }
        assertNotNull(claim, who + " has no eligible car");
        String car = claim.get("orderUuid").asText();
        claim.put("commandId", "claim-" + id());
        Response claimed = as(who).body(claim.toString()).post(BASE + "/manual/claim");
        assertEquals(200, claimed.statusCode(), claimed.asString());
        JsonNode hold = body(claimed).get("value").get("hold");
        Response reviewed = as(who).body("{\"commandId\":\"review-" + id() + "\",\"holdId\":\"" + hold.get("holdId").asText()
                + "\",\"expectedHoldVersion\":" + hold.get("version").asLong() + ",\"expectedDraftVersion\":1}")
                .post(BASE + "/manual/claim/review");
        assertEquals(200, reviewed.statusCode(), reviewed.asString());
        JsonNode inReview = body(reviewed).get("value");
        String digest = body(as(who).get(ORDERING + "/terms")).get("value").get("termsDigest").asText();
        String json = "{\"commandId\":\"cmd-" + id() + "\",\"source\":{\"type\":\"cart\",\"holdId\":\"" + hold.get("holdId").asText()
                + "\",\"expectedHoldVersion\":" + inReview.get("hold").get("version").asLong()
                + ",\"expectedDraftVersion\":1},\"expectedQuoteId\":\"" + inReview.get("quote").get("quoteId").asText()
                + "\",\"expectedStockVersion\":" + inReview.get("quote").get("stockVersion").asLong() + ",\"termsDigest\":\""
                + digest + "\",\"declarations\":{\"terms\":true,\"driver\":true,\"return\":true}}";
        Response r = as(who).body(json).post(ORDERING);
        assertEquals(200, r.statusCode(), r.asString());
        assertEquals("acknowledged", body(r).get("value").get("status").asText());
        assertEquals(car, body(r).get("value").get("selection").get("orderUuid").asText());
        return car;
    }

    // ---- the presenter's clock and approvals ----

    JsonNode clock() throws Exception {
        Response r = as("presenter").get(PRESENTER + "/clock");
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    Instant now() throws Exception {
        return Instant.parse(clock().get("now").asText());
    }

    void tick() throws Exception {
        long version = clock().get("clockVersion").asLong();
        Response r = as("presenter").body("{\"tickId\":\"dj-" + (++seq) + "-" + id() + "\",\"expectedClockVersion\":" + version + "}")
                .post(PRESENTER + "/clock/tick");
        assertEquals(200, r.statusCode(), r.asString());
        assertEquals("completed", body(r).get("value").get("state").asText(), r.asString());
    }

    void advanceAndTick(Instant to) throws Exception {
        long version = clock().get("clockVersion").asLong();
        Response moved = as("presenter").body("{\"commandId\":\"adv-" + id() + "\",\"expectedClockVersion\":" + version
                + ",\"to\":\"" + to + "\"}").post(PRESENTER + "/clock/advance");
        assertEquals(200, moved.statusCode(), moved.asString());
        tick();
    }

    /** Approvals ticks until ordering holds both orders. */
    void sendBothToOrdering(String a, String b) throws Exception {
        for (int i = 0; i < 20 && !(sent("greg", a) && sent("greg", b)); i++) {
            JsonNode c = clock();
            String id = "da-" + (++seq) + "-" + id();
            Response r = as("presenter").body("{\"commandId\":\"cmd-" + id + "\",\"tickId\":\"" + id + "\",\"now\":\""
                    + Instant.parse(c.get("now").asText()) + "\",\"clockVersion\":" + c.get("clockVersion").asLong() + "}")
                    .post(PRESENTER + "/approvals/ticks");
            assertEquals(200, r.statusCode(), r.asString());
        }
        assertTrue(sent("greg", a) && sent("greg", b), "both orders reach ordering");
    }

    private boolean sent(String who, String order) throws Exception {
        Response r = as(who).get(BASE + "/orders/progress?orderUuid=" + order);
        assertEquals(200, r.statusCode(), r.asString());
        return "sent-to-ordering".equals(body(r).get("value").get("outcome").asText());
    }

    // ---- documents ----

    Response documents(String who) throws Exception {
        return as(who).get(BASE + "/documents");
    }

    /** The employee's view of one order, or null when their list does not hold it. */
    JsonNode order(String who, String orderUuid) throws Exception {
        Response r = documents(who);
        assertEquals(200, r.statusCode(), r.asString());
        for (JsonNode o : body(r).get("value").get("orders")) if (orderUuid.equals(o.get("orderUuid").asText())) return o;
        return null;
    }

    static JsonNode item(JsonNode order, String itemId) {
        for (JsonNode i : order.get("items")) if (itemId.equals(i.get("itemId").asText())) return i;
        throw new AssertionError(itemId + " missing in " + order.get("items"));
    }

    static JsonNode task(JsonNode order, String itemId) {
        for (JsonNode t : order.get("tasks")) if (itemId.equals(t.get("itemId").asText())) return t;
        return null;
    }

    Response readiness(String who, String orderUuid) throws Exception {
        return as(who).get(BASE + "/documents/readiness?orderUuid=" + orderUuid);
    }

    JsonNode readinessValue(String who, String orderUuid) throws Exception {
        Response r = readiness(who, orderUuid);
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    static String ackJson(String commandId, String orderUuid, String itemId, long revision) {
        return "{\"commandId\":\"" + commandId + "\",\"orderUuid\":\"" + orderUuid + "\",\"itemId\":\"" + itemId
                + "\",\"expectedDocumentsRevision\":" + revision + "}";
    }

    Response post(String who, String path, String json) throws Exception {
        return as(who).body(json).post(BASE + "/documents/tasks/" + path);
    }

    static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }

    static List<String> sorted(JsonNode object) {
        List<String> names = new ArrayList<>();
        object.fieldNames().forEachRemaining(names::add);
        java.util.Collections.sort(names);
        return names;
    }
}
