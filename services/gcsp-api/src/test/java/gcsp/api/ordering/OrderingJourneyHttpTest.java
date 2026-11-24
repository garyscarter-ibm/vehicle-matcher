package gcsp.api.ordering;

import static gcsp.api.appointments.ReturnJourneySteps.withCollectionDate;
import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.StockDbFixture;
import gcsp.api.identity.IdentityPort;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.enterprise.inject.Any;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.spi.Bean;
import jakarta.enterprise.inject.spi.BeanManager;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/**
 * The employee's cart ordering handoff over HTTP on the started dev composition: real RS256 tokens, a private schema,
 * demo-prepared people and synthetic ordering, with no test alternative. Only released stock (upstream supply) is seeded.
 */
@QuarkusTest
@TestProfile(OrderingJourneyProfile.class)
class OrderingJourneyHttpTest {

    private static final String BASE = "/api/gcsp/v1";
    private static final String ORDER = BASE + "/manual/order";
    private static final String DETAILS = BASE + "/manual/review-details";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static String ownedSchema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    IdentityPort identity;

    @Inject
    OrderingServiceHolder holder;

    @Inject
    OrderingProviderBindings bindings;

    @Inject
    OrderingConversions conversions;

    @Inject
    BeanManager beans;

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_ordjourney_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    // ---- helpers ----

    private RequestSpecification paula() throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer("https://issuer.test/realms/gcsp");
        c.setAudience("gcsp-api");
        c.setSubject("sub-paula");
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", "gcsp-web");
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of("employee")));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return given().header("Authorization", "Bearer " + jws.getCompactSerialization()).contentType("application/json");
    }

    private static JsonNode body(Response r) throws Exception {
        return JSON.readTree(r.asString());
    }

    private static String id() {
        return UUID.randomUUID().toString();
    }

    private long count(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    private String text(String sql) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql);
                ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getString(1) : null;
        }
    }

    /** The handoff's whole footprint: intent, selection, provider receipt and every ordering outbox event. */
    private long footprint() throws Exception {
        return count("SELECT (SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order') "
                + "+ (SELECT count(*) FROM selection_orders) + (SELECT count(*) FROM ordering_synthetic_receipts) "
                + "+ (SELECT count(*) FROM outbox_events WHERE event_type LIKE 'ordering.%')");
    }

    private Response refusedSubmit(String json, int status, String code) throws Exception {
        Response r = paula().body(json).post(ORDER);
        assertEquals(status, r.statusCode(), r.asString());
        assertEquals(code, body(r).get("code").asText(), r.asString());
        assertEquals(0, footprint(), "a refused submit writes nothing: " + r.asString());
        return r;
    }

    /** Released stock is upstream supply (the supply release is not part of this story), so it is the one thing seeded. */
    private void seedStock() throws Exception {
        var run = persistence.guard().currentRun();
        try (Connection c = dataSource.get().getConnection()) {
            StockDbFixture.insertStock(c, run.environmentId(), run.runId(), StockDbFixture.rows());
        }
    }

    private static ObjectNode submitBody(String commandId, JsonNode claim, long detailsVersion, String digest) {
        ObjectNode b = JSON.createObjectNode();
        b.put("commandId", commandId);
        b.putObject("source").put("type", "cart").put("holdId", claim.get("hold").get("holdId").asText())
                .put("expectedHoldVersion", claim.get("hold").get("version").asLong()).put("expectedDraftVersion", 1);
        b.put("expectedQuoteId", claim.get("quote").get("quoteId").asText());
        b.put("expectedStockVersion", claim.get("quote").get("stockVersion").asLong());
        b.put("termsDigest", digest);
        b.put("expectedReviewDetailsVersion", detailsVersion);
        b.putObject("declarations").put("terms", true).put("driver", true).put("return", true);
        return b;
    }

    // ---- the journey ----

    @Test
    void cartHandoffIsFrozenRefusedWithoutWritesAndAcknowledgedOnceThroughTheStartedComposition() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;

        // 7. The composition is the dev one: OIDC identity, synthetic ordering, the cart converter, no alternative bean.
        assertEquals("oidc", identity.mode());
        assertEquals("synthetic", holder.provider());
        assertEquals("synthetic", bindings.mode());
        assertInstanceOf(SyntheticOrderingProvider.class, bindings.provider(dataSource.get()));
        assertEquals("cart", conversions.forSource("cart").sourceType());
        assertInstanceOf(gcsp.api.claims.CartSelectionConversion.class, conversions.forSource("cart"));
        assertTrue(new OrderingJourneyProfile().getEnabledAlternatives().isEmpty());
        for (Bean<?> bean : beans.getBeans(Object.class, Any.Literal.INSTANCE)) {
            assertFalse(bean.isAlternative() && bean.getBeanClass().getName().startsWith("gcsp."),
                    "no alternative may stand in: " + bean.getBeanClass());
        }

        // Account, draft, stock, claim and review through the real routes.
        seedStock();
        JsonNode account = body(paula().get(BASE + "/manual/account")).get("value");
        assertEquals("ready", account.get("state").asText());
        assertTrue(account.get("slots").get(0).get("ordering").get("enabled").asBoolean());
        String draft = withCollectionDate(account, StockDbFixture.complete()).toString();
        Response saved = paula().body("{\"commandId\":\"draft-" + id() + "\",\"expectedDraftVersion\":0,\"expectedContextVersion\":\""
                + account.get("contextVersion").asText() + "\",\"choices\":" + draft + "}").post(BASE + "/manual/draft");
        assertEquals(200, saved.statusCode(), saved.asString());
        Response browse = paula().get(BASE + "/manual/stock");
        assertEquals(200, browse.statusCode(), browse.asString());
        ObjectNode claimInput = null;
        for (JsonNode d : body(browse).get("value").get("decisions")) {
            if (claimInput == null && "eligible".equals(d.get("gateStatus").asText())) claimInput = ((ObjectNode) d.get("claimInput")).deepCopy();
        }
        assertNotNull(claimInput, "paula has no eligible car");
        String car = claimInput.get("orderUuid").asText();
        claimInput.put("commandId", "claim-" + id());
        Response claimed = paula().body(claimInput.toString()).post(BASE + "/manual/claim");
        assertEquals(200, claimed.statusCode(), claimed.asString());
        JsonNode hold = body(claimed).get("value").get("hold");
        Response reviewed = paula().body("{\"commandId\":\"review-" + id() + "\",\"holdId\":\"" + hold.get("holdId").asText()
                + "\",\"expectedHoldVersion\":" + hold.get("version").asLong() + ",\"expectedDraftVersion\":1}")
                .post(BASE + "/manual/claim/review");
        assertEquals(200, reviewed.statusCode(), reviewed.asString());
        String holdId = hold.get("holdId").asText();

        // 1. Review details: read the unsaved version, then save them and take the new version.
        JsonNode unsaved = body(paula().get(DETAILS)).get("value");
        assertEquals(0, unsaved.get("reviewDetailsVersion").asLong());
        long holdVersion = body(reviewed).get("value").get("hold").get("version").asLong();
        String quoteId = body(reviewed).get("value").get("quote").get("quoteId").asText();
        Response savedDetails = paula().body("{\"commandId\":\"details-" + id() + "\",\"holdId\":\"" + holdId + "\",\"quoteId\":\""
                + quoteId + "\",\"expectedHoldVersion\":" + holdVersion + ",\"expectedDraftVersion\":1,"
                + "\"expectedReviewDetailsVersion\":0,\"details\":{\"contact\":{\"phone\":\"01632 960000\","
                + "\"email\":\"paula@example.test\"},\"expectedReturnMileage\":12000,\"specialRequirements\":\"Call first\"}}")
                .post(DETAILS);
        assertEquals(200, savedDetails.statusCode(), savedDetails.asString());
        long detailsVersion = body(savedDetails).get("value").get("reviewDetailsVersion").asLong();
        assertEquals(1, detailsVersion);
        JsonNode claim = body(paula().get(BASE + "/manual/claim")).get("value");

        // 2. The terms digest the declarations are made against.
        Response termsResponse = paula().get(ORDER + "/terms");
        assertEquals(200, termsResponse.statusCode(), termsResponse.asString());
        String digest = body(termsResponse).get("value").get("termsDigest").asText();
        assertEquals(0, footprint());

        // 3. Refusals, each with nothing written.
        ObjectNode noDeclaration = submitBody("c-nodecl-" + id(), claim, detailsVersion, digest);
        ((ObjectNode) noDeclaration.get("declarations")).remove("driver");
        refusedSubmit(noDeclaration.toString(), 400, "invalid");
        ObjectNode falseDeclaration = submitBody("c-false-" + id(), claim, detailsVersion, digest);
        ((ObjectNode) falseDeclaration.get("declarations")).put("return", false);
        refusedSubmit(falseDeclaration.toString(), 400, "invalid");
        refusedSubmit(submitBody("c-digest-" + id(), claim, detailsVersion, "0".repeat(64)).toString(), 409, "terms-changed");
        ObjectNode staleHold = submitBody("c-hold-" + id(), claim, detailsVersion, digest);
        ((ObjectNode) staleHold.get("source")).put("expectedHoldVersion", claim.get("hold").get("version").asLong() + 1);
        refusedSubmit(staleHold.toString(), 409, "claim-changed");
        ObjectNode staleQuote = submitBody("c-quote-" + id(), claim, detailsVersion, digest);
        staleQuote.put("expectedQuoteId", "manual-quote:other");
        refusedSubmit(staleQuote.toString(), 409, "quote-binding-changed");
        ObjectNode staleStock = submitBody("c-stock-" + id(), claim, detailsVersion, digest);
        staleStock.put("expectedStockVersion", claim.get("quote").get("stockVersion").asLong() + 1);
        refusedSubmit(staleStock.toString(), 409, "stock-changed");
        refusedSubmit(submitBody("c-details-" + id(), claim, detailsVersion + 1, digest).toString(), 409, "stale-review-details");

        // 4. The good submit.
        String command = "cmd-" + id();
        ObjectNode good = submitBody(command, claim, detailsVersion, digest);
        Response ok = paula().body(good.toString()).post(ORDER);
        assertEquals(200, ok.statusCode(), ok.asString());
        JsonNode value = body(ok).get("value");
        assertEquals("ok", body(ok).get("status").asText());
        assertEquals("acknowledged", value.get("status").asText());
        String reference = value.get("providerReference").asText();
        assertTrue(reference.startsWith("synthetic-ordering:v1:"), reference);
        assertEquals(car, value.get("selection").get("orderUuid").asText());
        assertEquals("cart", value.get("selection").get("sourceType").asText());
        assertEquals("awaiting-approval", value.get("view").get("state").asText());
        String operationId = value.get("operationId").asText();

        // The selection keeps the frozen review details and the declarations the employee made.
        JsonNode stored = JSON.readTree(text("SELECT selection::text FROM selection_orders"));
        assertEquals(detailsVersion, stored.get("reviewDetails").get("reviewDetailsVersion").asLong());
        assertEquals("Call first", stored.get("reviewDetails").get("details").get("specialRequirements").asText());
        assertEquals(12000, stored.get("reviewDetails").get("details").get("expectedReturnMileage").asInt());
        assertEquals(holdId, stored.get("reviewDetails").get("binding").get("holdId").asText());
        assertTrue(stored.get("declarations").get("return").asBoolean());

        // 5. Durable: one intent finalised, one provider receipt, one acknowledgement event.
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order' "
                + "AND state = 'acknowledged' AND provider_reference = ? AND operation_id = ?", reference, operationId));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order'"));
        assertEquals(1, count("SELECT count(*) FROM ordering_synthetic_receipts WHERE operation_id = ?", operationId));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged'"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-received'"));
        assertEquals(0, count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-refused'"));
        assertEquals(reference, text("SELECT payload->>'providerReference' FROM outbox_events "
                + "WHERE event_type = 'ordering.selection-acknowledged'"));
        Response read = paula().get(ORDER);
        assertEquals(200, read.statusCode(), read.asString());
        assertEquals("acknowledged", body(read).get("value").get("status").asText());
        assertEquals(reference, body(read).get("value").get("providerReference").asText());

        // 6. The same command replays; a changed body or a second command for the slot makes no second order.
        Response again = paula().body(good.toString()).post(ORDER);
        assertEquals(200, again.statusCode(), again.asString());
        assertEquals(operationId, body(again).get("value").get("operationId").asText());
        assertEquals(reference, body(again).get("value").get("providerReference").asText());
        assertTrue(body(again).get("value").get("replayed").asBoolean());
        ObjectNode changed = good.deepCopy();
        changed.put("expectedStockVersion", good.get("expectedStockVersion").asLong() + 1);
        Response changedBody = paula().body(changed.toString()).post(ORDER);
        assertEquals(409, changedBody.statusCode(), changedBody.asString());
        assertEquals("active-selection-exists", body(changedBody).get("code").asText());
        ObjectNode second = changed.deepCopy();
        second.put("commandId", "cmd-second-" + id());
        Response secondOrder = paula().body(second.toString()).post(ORDER);
        assertEquals(409, secondOrder.statusCode(), secondOrder.asString());
        assertEquals("active-selection-exists", body(secondOrder).get("code").asText());
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order'"));
        assertEquals(1, count("SELECT count(*) FROM ordering_synthetic_receipts"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged'"));
        assertEquals(reference, text("SELECT provider_reference FROM pending_operations WHERE operation_type = 'selection-order'"));
    }
}
