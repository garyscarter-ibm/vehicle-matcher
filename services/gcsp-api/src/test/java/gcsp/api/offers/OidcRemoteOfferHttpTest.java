package gcsp.api.offers;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountSelection;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.identity.IdentityPort;
import gcsp.api.ordering.OrderingServiceHolder;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import io.restassured.response.ValidatableResponse;
import jakarta.enterprise.inject.spi.BeanManager;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.Test;

/**
 * Real Quarkus/JWKS/HTTP/PG composition from a seeded remote-offered boundary, with a profile-scoped policy clock.
 * This is not claim production, browser login, email delivery, hosted/BMW proof or the full order-status HTTP journey.
 */
@QuarkusTest
@TestProfile(OidcRemoteOfferProfile.class)
class OidcRemoteOfferHttpTest {

    private static final String API = "/api/gcsp/v1";
    private static final String COMMAND = "oidc-remote-accept-1";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "gcsp.test.oidc-remote-offer.offer-id")
    String offerId;

    @Inject
    IdentityPort identity;

    @Inject
    RemoteBuddy buddy;

    @Inject
    AccountSelection accounts;

    @Inject
    OrderingServiceHolder ordering;

    @Inject
    BeanManager beans;

    @Inject
    AgroalDataSource dataSource;

    @Test
    void ownerJwtAcceptsThroughStartupSelectedRemoteBuddyAndReadsAcceptedOffer() throws Exception {
        pinSeededOfferReadFacts();
        assertEquals("oidc", identity.mode());
        assertEquals("remote", buddy.mode());
        assertEquals("repository", accounts.mode());
        assertEquals("synthetic", ordering.provider());
        var recordsBean = beans.resolve(beans.getBeans(OfferRecords.class));
        assertNotNull(recordsBean, "the application must resolve an offer-record bean");
        assertEquals(PostgresOfferRecords.class, recordsBean.getBeanClass(),
                "the globally enabled in-memory test alternative must be excluded");

        String path = API + "/offers/" + offerId;
        ObjectNode refusedAttempt = accept("unused-for-refused-caller", 1, 1);
        assertNoSelection();
        given().contentType("application/json").body(refusedAttempt.toString()).when().post(path + "/decision")
                .then().statusCode(401).body("code", equalTo("bearer-missing"));
        assertNoSelection();
        post(token("sub-employee-b"), path + "/decision", refusedAttempt).statusCode(403)
                .body("code", equalTo("offer-not-owned"));
        assertNoSelection();

        String owner = token("sub-employee-a");
        get(owner, API + "/context").statusCode(200).body("value.employeeId", equalTo(DecisionEnv.EMPLOYEE))
                .body("value.environmentId", equalTo(OffersPg.ENV)).body("value.runId", equalTo("run-1"));
        String termsDigest = get(owner, API + "/manual/order/terms").statusCode(200)
                .body("status", equalTo("ok")).extract().jsonPath().getString("value.termsDigest");
        assertNotNull(termsDigest);
        assertFalse(termsDigest.isBlank());
        JsonPath offered = get(owner, path).statusCode(200).body("value.offerId", equalTo(offerId))
                .body("value.state", equalTo("pending")).body("value.reason", equalTo("awaiting-decision"))
                .extract().jsonPath();

        // The remote protocol returns its stored pending receipt even when this inline drive converts immediately.
        ObjectNode command = accept(termsDigest, offered.getLong("value.offerVersion"), offered.getLong("value.holdVersion"));
        String pendingJson = post(owner, path + "/decision", command)
                .statusCode(202).body("status", equalTo("pending")).body("code", equalTo("decision-pending"))
                .body("retryable", equalTo(false)).body("offerId", equalTo(offerId))
                .body("commandId", equalTo(COMMAND)).body("$", not(hasKey("value")))
                .body("$", not(hasKey("decisionId")))
                .extract().asString();
        String operationId = JsonPath.from(pendingJson).getString("operationId");
        ObjectNode parserFixture = JsonNodeFactory.instance.objectNode().put("employeeId", DecisionEnv.EMPLOYEE);
        parserFixture.set("input", command.deepCopy().put("offerId", offerId));
        parserFixture.set("receipt", DecisionEnv.JSON.readTree(pendingJson));
        System.out.println("F466_REMOTE_PENDING " + parserFixture);
        assertNotNull(operationId);
        assertFalse(operationId.isBlank());
        get(owner, path).statusCode(200).body("value.state", equalTo("accepted"))
                .body("value.reason", equalTo("accepted")).body("value.holdState", equalTo("allocated"))
                .body("value.availableActions", hasSize(0));

        assertEquals(1, count("SELECT count(*) FROM offer_decisions"));
        assertEquals(1, count("SELECT count(*) FROM offer_decisions WHERE offer_id = ? AND decision = 'accept' "
                + "AND command_id = ?", offerId, COMMAND));
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, count("SELECT count(*) FROM selection_orders s JOIN buddy_offers o "
                + "ON o.environment_id = s.environment_id AND o.run_id = s.run_id AND o.order_uuid = s.order_uuid "
                + "WHERE o.offer_id = ? AND s.employee_id = ?", offerId, DecisionEnv.EMPLOYEE));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'offer-selection'"));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_id = ? "
                + "AND operation_type = 'offer-selection' AND state = 'acknowledged'", operationId));
        assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE state = 'allocated'"));
        assertEquals(1, count("SELECT count(*) FROM stock_cars WHERE state = 'allocated'"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted' "
                + "AND event_id = 'offer-accepted:' || (SELECT hold_id FROM buddy_offers WHERE offer_id = ?)", offerId));
    }

    /** This test's hand-built remote boundary also carries the public read pins a generated offer has. */
    private void pinSeededOfferReadFacts() throws Exception {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            try (PreparedStatement read = c.prepareStatement("SELECT o.environment_id, o.run_id, o.policy_version, "
                    + "o.brief_version, q.quote_id, q.order_uuid, q.vehicle_name, q.image_path, q.monthly_points, "
                    + "q.quoted_at, q.valid_until, q.quote::text, e.attributes::text, rc.clock_version FROM buddy_offers o "
                    + "JOIN buddy_quotes q USING (environment_id, run_id, quote_id) "
                    + "JOIN run_clocks rc USING (environment_id, run_id) "
                    + "JOIN employees e ON e.environment_id = o.environment_id AND e.run_id = o.run_id "
                    + "AND e.employee_id = o.employee_id WHERE o.offer_id = ?")) {
                read.setString(1, offerId);
                try (ResultSet row = read.executeQuery()) {
                    assertTrue(row.next());
                    String environment = row.getString(1), run = row.getString(2), policyVersion = row.getString(3);
                    String quotedAt = PolicyClock.iso(row.getObject(10, java.time.OffsetDateTime.class).toInstant());
                    String validUntil = PolicyClock.iso(row.getObject(11, java.time.OffsetDateTime.class).toInstant());
                    ObjectNode quote = (ObjectNode) DecisionEnv.JSON.readTree(row.getString(12));
                    var employee = DecisionEnv.JSON.readTree(row.getString(13));
                    var allowance = DecisionEnv.policy(false).getAllowance(new PolicyContext(run,
                            employee.path("companyId").asText(), employee.path("schemeId").asText(),
                            employee.path("gradeId").asText()), new PolicyRead(run, quotedAt, policyVersion));
                    assertTrue(allowance.ok());
                    assertEquals(policyVersion, allowance.policyVersion());
                    ObjectNode provenance = JsonNodeFactory.instance.objectNode().put("sourceRef", "test:oidc-remote-offer-boundary")
                            .put("observedAt", quotedAt).put("version", policyVersion).put("assurance", "synthetic-scenario");
                    ObjectNode snapshot = (ObjectNode) quote.get("snapshot");
                    snapshot.put("contractVersion", "vehicle-snapshot-v1").put("identityKind", "exact-stock")
                            .put("candidateKey", "stock:" + row.getString(6)).put("sourceNamespace", "test:oidc-remote-offer-boundary")
                            .put("snapshotVersion", "1").put("observedAt", quotedAt);
                    snapshot.putObject("sourceKeys").put("stockId", row.getString(6));
                    snapshot.putObject("display").put("name", row.getString(7)).put("photo", row.getString(8)).putArray("images");
                    snapshot.path("facts").forEach(fact -> {
                        ((ObjectNode) fact).putNull("unit").set("provenance", provenance.deepCopy());
                    });
                    ObjectNode terms = quote.putObject("terms").put("kind", "employee-scheme")
                            .put("termsVersion", "seeded-remote-offer-v1").put("validFrom", quotedAt).put("validUntil", validUntil);
                    terms.putObject("points").put("value", row.getInt(9)).put("unit", "points");
                    terms.set("provenance", provenance);
                    terms.putObject("allowanceInputs").putObject("allowance")
                            .put("value", allowance.value().path("monthlyPoints").longValue()).put("unit", "points");
                    // The application startup already supplies this run's persisted clock.
                    quote.putObject("versions").put("brief", row.getLong(4)).put("policy", policyVersion)
                            .put("clock", row.getString(14));
                    try (var statement = c.createStatement()) {
                        statement.execute("ALTER TABLE buddy_quotes DISABLE TRIGGER buddy_quotes_immutable");
                        try (PreparedStatement update = c.prepareStatement("UPDATE buddy_quotes SET quote = ?::jsonb "
                                + "WHERE environment_id = ? AND run_id = ? AND quote_id = ?")) {
                            update.setString(1, quote.toString()); update.setString(2, environment);
                            update.setString(3, run); update.setString(4, row.getString(5));
                            assertEquals(1, update.executeUpdate());
                        }
                        statement.execute("ALTER TABLE buddy_quotes ENABLE TRIGGER buddy_quotes_immutable");
                    }
                }
            }
            c.commit();
        }
    }

    private void assertNoSelection() throws SQLException {
        assertEquals(0, count("SELECT count(*) FROM offer_decisions"));
        assertEquals(0, count("SELECT count(*) FROM selection_orders"));
        assertEquals(0, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'offer-selection'"));
    }

    private static ObjectNode accept(String termsDigest, long offerVersion, long holdVersion) {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("commandId", COMMAND).put("decision", "accept").put("expectedOfferVersion", offerVersion)
                .put("expectedHoldVersion", holdVersion).put("termsDigest", termsDigest);
        body.put("runId", "run-1").put("expectedQuoteVersion", 1);
        body.putObject("declarations").put("terms", true).put("driver", true);
        return body;
    }

    private String token(String subject) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims claims = new JwtClaims();
        claims.setIssuer(OffersTestProfile.ISSUER);
        claims.setAudience(OffersTestProfile.AUDIENCE);
        claims.setSubject(subject);
        claims.setExpirationTimeMinutesInTheFuture(10);
        claims.setIssuedAtToNow();
        claims.setClaim("azp", OffersTestProfile.CLIENT);
        claims.setClaim("scope", "openid gcsp-api");
        claims.setClaim("realm_access", Map.of("roles", List.of("employee")));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(claims.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue(key.getKeyId());
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private static ValidatableResponse get(String token, String path) {
        return given().header("Authorization", "Bearer " + token).when().get(path).then();
    }

    private static ValidatableResponse post(String token, String path, ObjectNode body) {
        return given().header("Authorization", "Bearer " + token).contentType("application/json")
                .body(body.toString()).when().post(path).then();
    }

    private long count(String sql, Object... parameters) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) ps.setObject(i + 1, parameters[i]);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                return rs.getLong(1);
            }
        }
    }
}
