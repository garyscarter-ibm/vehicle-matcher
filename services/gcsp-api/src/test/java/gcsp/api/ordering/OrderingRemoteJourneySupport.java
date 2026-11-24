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
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
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
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterAll;
import org.postgresql.ds.PGSimpleDataSource;

/** Shared steps of the remote-provider journeys: real RS256 tokens, the cart journey routes and the loopback endpoint. */
abstract class OrderingRemoteJourneySupport {

    static final String BASE = "/api/gcsp/v1";
    static final String ORDER = BASE + "/manual/order";
    static final String DETAILS = BASE + "/manual/review-details";
    static final ObjectMapper JSON = new ObjectMapper();
    static String ownedSchema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.ordering.execute-url")
    String executeUrl;

    @ConfigProperty(name = "gcsp.ordering.reconcile-url")
    String reconcileUrl;

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
    OrderingStartup startup;

    @Inject
    PolicyService policy;

    @Inject
    PolicyClock clock;

    @Inject
    BeanManager beans;

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_ordremote_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    // ---- helpers ----

    RequestSpecification as(String subject, String role) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer("https://issuer.test/realms/gcsp");
        c.setAudience("gcsp-api");
        c.setSubject(subject);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", "gcsp-web");
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return given().header("Authorization", "Bearer " + jws.getCompactSerialization()).contentType("application/json");
    }

    RequestSpecification employee(String who) throws Exception {
        return as("sub-" + who, "employee");
    }

    static JsonNode body(Response r) throws Exception {
        return JSON.readTree(r.asString());
    }

    static String id() {
        return UUID.randomUUID().toString();
    }

    long count(String sql, Object... params) throws Exception {
        String v = text(sql, params);
        return v == null ? 0 : Long.parseLong(v);
    }

    String text(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    String endpoint(String path) {
        return reconcileUrl.substring(0, reconcileUrl.length() - "/reconcile".length()) + path;
    }

    JsonNode stats() throws Exception {
        return JSON.readTree(given().get(endpoint("/stats")).asString());
    }

    void mode(String mode) {
        assertEquals(200, given().post(endpoint("/control?mode=" + mode)).statusCode());
    }

    /** Polls a bounded time; the retry lease is five wall-clock seconds, so this never sleeps blindly. */
    static boolean until(Duration max, BooleanSupplier done) throws Exception {
        long end = System.nanoTime() + max.toNanos();
        while (System.nanoTime() < end) {
            if (done.getAsBoolean()) return true;
            Thread.sleep(250);
        }
        return done.getAsBoolean();
    }

    /** Released stock is upstream supply (not part of this story), so it is the one thing seeded. */
    void seedStock() throws Exception {
        var run = persistence.guard().currentRun();
        try (Connection c = dataSource.get().getConnection()) {
            StockDbFixture.insertStock(c, run.environmentId(), run.runId(), StockDbFixture.rows());
        }
    }

    /** Account, draft, stock, claim, review details and terms through the real routes; returns the exact submit body. */
    ObjectNode prepare(String who) throws Exception {
        Response accountResponse = employee(who).get(BASE + "/manual/account");
        assertEquals(200, accountResponse.statusCode(), who + ": " + accountResponse.asString());
        JsonNode account = body(accountResponse).get("value");
        assertEquals("ready", account.get("state").asText(), who);
        assertTrue(account.get("slots").get(0).get("ordering").get("enabled").asBoolean(), who);
        ObjectNode choices = StockDbFixture.complete().deepCopy();
        choices.put("slotId", "slot-" + who).put("driverId", "driver:employee-" + who);
        // Jordan has no current contract, so the draft is a new order; Paula replaces hers.
        if ("jordan".equals(who)) choices.put("mode", "new").putNull("oldContractId").putNull("expectedReturnMileage");
        else choices.put("oldContractId", "current:employee-" + who);
        choices.with("contact").put("email", who + "@gcsp-demo.com");
        String draft = withCollectionDate(account, choices).toString();
        Response saved = employee(who).body("{\"commandId\":\"draft-" + id() + "\",\"expectedDraftVersion\":0,"
                + "\"expectedContextVersion\":\"" + account.get("contextVersion").asText() + "\",\"choices\":" + draft + "}")
                .post(BASE + "/manual/draft");
        assertEquals(200, saved.statusCode(), saved.asString());
        Response browse = employee(who).get(BASE + "/manual/stock");
        assertEquals(200, browse.statusCode(), browse.asString());
        ObjectNode claimInput = null;
        for (JsonNode d : body(browse).get("value").get("decisions")) {
            if (claimInput == null && "eligible".equals(d.get("gateStatus").asText())) claimInput = ((ObjectNode) d.get("claimInput")).deepCopy();
        }
        assertNotNull(claimInput, who + " has no eligible car");
        claimInput.put("commandId", "claim-" + id());
        Response claimed = employee(who).body(claimInput.toString()).post(BASE + "/manual/claim");
        assertEquals(200, claimed.statusCode(), claimed.asString());
        JsonNode hold = body(claimed).get("value").get("hold");
        Response reviewed = employee(who).body("{\"commandId\":\"review-" + id() + "\",\"holdId\":\"" + hold.get("holdId").asText()
                + "\",\"expectedHoldVersion\":" + hold.get("version").asLong() + ",\"expectedDraftVersion\":1}")
                .post(BASE + "/manual/claim/review");
        assertEquals(200, reviewed.statusCode(), reviewed.asString());
        long holdVersion = body(reviewed).get("value").get("hold").get("version").asLong();
        String quoteId = body(reviewed).get("value").get("quote").get("quoteId").asText();
        Response savedDetails = employee(who).body("{\"commandId\":\"details-" + id() + "\",\"holdId\":\""
                + hold.get("holdId").asText() + "\",\"quoteId\":\"" + quoteId + "\",\"expectedHoldVersion\":" + holdVersion
                + ",\"expectedDraftVersion\":1,\"expectedReviewDetailsVersion\":0,\"details\":{\"contact\":{\"phone\":"
                + "\"01632 960000\",\"email\":\"" + who + "@example.test\"}" + ("jordan".equals(who) ? "" : ",\"expectedReturnMileage\":12000")
                + ",\"specialRequirements\":\"Call first\"}}").post(DETAILS);
        assertEquals(200, savedDetails.statusCode(), savedDetails.asString());
        long detailsVersion = body(savedDetails).get("value").get("reviewDetailsVersion").asLong();
        JsonNode claim = body(employee(who).get(BASE + "/manual/claim")).get("value");
        Response terms = employee(who).get(ORDER + "/terms");
        assertEquals(200, terms.statusCode(), terms.asString());
        ObjectNode b = JSON.createObjectNode();
        b.put("commandId", "cmd-" + who + "-" + id());
        b.putObject("source").put("type", "cart").put("holdId", claim.get("hold").get("holdId").asText())
                .put("expectedHoldVersion", claim.get("hold").get("version").asLong()).put("expectedDraftVersion", 1);
        b.put("expectedQuoteId", claim.get("quote").get("quoteId").asText());
        b.put("expectedStockVersion", claim.get("quote").get("stockVersion").asLong());
        b.put("termsDigest", body(terms).get("value").get("termsDigest").asText());
        b.put("expectedReviewDetailsVersion", detailsVersion);
        // The declarations the terms require for this order mode: a new order has no returning car to declare.
        String mode = "jordan".equals(who) ? "new" : "replacement";
        ObjectNode declarations = b.putObject("declarations");
        for (JsonNode d : body(terms).get("value").get("declarations")) {
            String applies = d.get("appliesTo").asText();
            if ("all".equals(applies) || mode.equals(applies)) declarations.put(d.get("id").asText(), true);
        }
        return b;
    }

    Response submit(String who, ObjectNode submit) throws Exception {
        return employee(who).body(submit.toString()).post(ORDER);
    }

    JsonNode view(Response r, int status) throws Exception {
        assertEquals(status, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    String operationOf(String who) throws Exception {
        return text("SELECT operation_id FROM selection_orders WHERE employee_id = ?", "employee-" + who);
    }

    long ops(String sql, String operationId) throws Exception {
        return count(sql, operationId);
    }

    String stateOf(String operationId) throws Exception {
        return text("SELECT state FROM pending_operations WHERE operation_type = 'selection-order' AND operation_id = ?",
                operationId);
    }

    /** The composition is the dev one with the remote provider: OIDC, HttpOrderingProvider, no alternative bean. */
    void assertRemoteComposition() {
        assertEquals("oidc", identity.mode());
        assertEquals("remote", holder.provider());
        assertEquals("remote", bindings.mode());
        assertInstanceOf(HttpOrderingProvider.class, bindings.provider(dataSource.get()));
        assertTrue(new OrderingRemoteJourneyProfile().getEnabledAlternatives().isEmpty());
        for (Bean<?> bean : beans.getBeans(Object.class, Any.Literal.INSTANCE)) {
            assertFalse(bean.isAlternative() && bean.getBeanClass().getName().startsWith("gcsp."),
                    "no alternative may stand in: " + bean.getBeanClass());
        }
    }
}
