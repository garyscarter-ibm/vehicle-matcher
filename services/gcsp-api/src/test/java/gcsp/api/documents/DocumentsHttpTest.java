package gcsp.api.documents;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** The documents endpoints with real signed tokens over the native test database (skipped without its URL). */
@QuarkusTest
@TestProfile(DocumentsTestProfile.class)
class DocumentsHttpTest {

    private static final String ITEM = "agreement-acknowledgement";
    private static final String BASE = "/api/gcsp/v1/documents";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    private RsaJsonWebKey key;
    private String order;

    @BeforeEach
    void seed() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        order = "order-" + UUID.randomUUID();
        DocumentsTestPorts.OWNERS.put(order, "E-1001");
        sql("INSERT INTO document_orders (environment_id, run_id, order_uuid, employee_id, entitlement_slot_id, "
                + "renewal_id, renewal_authority, policy_version, opened_at, opening, last_observed_revision, "
                + "provider_mode, exception_types, assumptions) VALUES (?, ?, ?, 'E-1001', 'slot-a', 'renewal-a', "
                + "'validated', ?, now(), '{\"lifecycleRevision\":4}', 4, 'synthetic', '{}', '[]')",
                DocumentsTestProfile.ENVIRONMENT, DocumentsTestProfile.RUN, order, DocumentsPg.VERSION);
        sql("INSERT INTO document_items (environment_id, run_id, order_uuid, item_id, position, kind, label, owner, "
                + "action, status, due_at, assumption) VALUES (?, ?, ?, ?, 0, 'document', 'Vehicle agreement', "
                + "'employee', 'Acknowledge the agreement', 'waiting-for-employee', now() + interval '2 days', '{}')",
                DocumentsTestProfile.ENVIRONMENT, DocumentsTestProfile.RUN, order, ITEM);
    }

    @AfterEach
    void clean() throws Exception {
        if (order == null) return;
        sql("DELETE FROM pending_operations WHERE input_digest IS NOT NULL AND idempotency_key LIKE ?", order + ":%");
        sql("DELETE FROM document_items WHERE order_uuid = ?", order);
        sql("DELETE FROM document_orders WHERE order_uuid = ?", order);
        DocumentsTestPorts.OWNERS.remove(order);
    }

    private static void sql(String statement, Object... params) throws SQLException {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(DocumentsTestProfile.URL);
        ds.setCurrentSchema("gcsp_app");
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(statement)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

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

    private ValidatableResponse get(String token, String path) {
        return given().header("Authorization", "Bearer " + token).when().get(BASE + path).then();
    }

    private ValidatableResponse post(String token, String json) {
        return given().header("Authorization", "Bearer " + token).contentType(ContentType.JSON).body(json).when()
                .post(BASE + "/tasks/acknowledge").then();
    }

    private String ackBody(String commandId, long revision) {
        return "{\"commandId\":\"" + commandId + "-" + order + "\",\"orderUuid\":\"" + order + "\",\"itemId\":\"" + ITEM
                + "\",\"expectedDocumentsRevision\":" + revision + "}";
    }

    @Test
    void noTokenIsRefusedAsJson() {
        given().when().get(BASE).then().statusCode(401).contentType(containsString("application/json"))
                .body("code", equalTo("bearer-missing"));
        given().contentType(ContentType.JSON).body("{}").when().post(BASE + "/tasks/acknowledge").then()
                .statusCode(401);
    }

    @Test
    void anEmployeeReadsOwnDocumentsAndAnotherSeesNone() throws Exception {
        String a = token("sub-employee-a", "employee");
        get(a, "").statusCode(200).body("status", equalTo("ok"))
                .body("value.contractVersion", equalTo("lifecycle.documents.v1"))
                .body("value.orders", hasSize(1)).body("value.orders[0].orderUuid", equalTo(order))
                .body(not(containsString(a)));
        get(token("sub-employee-b", "employee"), "").statusCode(200).body("value.orders", empty());
    }

    @Test
    void readinessIsOwnedByTheEmployeeAndReadableByGregAndThePresenter() throws Exception {
        String path = "/readiness?orderUuid=" + order;
        get(token("sub-employee-a", "employee"), path).statusCode(200).body("value.opened", equalTo(true))
                .body("value.ready", equalTo(false)).body("value.documentsComplete", equalTo(false));
        get(token("sub-employee-b", "employee"), path).statusCode(403).body("code", equalTo("not-resource-owner"));
        get(token("sub-greg", "greg"), path).statusCode(200).body("value.opened", equalTo(true));
        get(token("sub-presenter", "presenter"), path).statusCode(200).body("value.opened", equalTo(true));
        get(token("sub-greg", "greg"), "/readiness?orderUuid=nothing-here").statusCode(200)
                .body("value.opened", equalTo(false)).body("value.state", equalTo("not-open"))
                .body("value.reason", equalTo("no-lifecycle-for-order"));
    }

    @Test
    void presenterAndGregCannotAcknowledgeOrReadTheEmployeeList() throws Exception {
        for (String[] who : new String[][] {{"sub-presenter", "presenter"}, {"sub-greg", "greg"}}) {
            String t = token(who[0], who[1]);
            post(t, ackBody("cmd-role", 1)).statusCode(403).body("code", equalTo("role-required"));
            get(t, "").statusCode(403).body("code", equalTo("role-required"));
        }
        get(token("sub-employee-a", "employee"), "/readiness?orderUuid=" + order).statusCode(200)
                .body("value.ready", equalTo(false));
    }

    @Test
    void anEmployeeAcknowledgesOwnTaskAndAnotherCannot() throws Exception {
        String a = token("sub-employee-a", "employee");
        String revision = get(a, "").statusCode(200).extract().path("value.orders[0].documentsRevision").toString();
        post(token("sub-employee-b", "employee"), ackBody("cmd-b", Long.parseLong(revision))).statusCode(403)
                .body("code", equalTo("not-resource-owner"));
        post(a, ackBody("cmd-a", Long.parseLong(revision) + 7)).statusCode(409).body("code", equalTo("stale-version"))
                .body("retryable", equalTo(true)).body("current.documentsRevision",
                        equalTo(Integer.parseInt(revision)));
        post(a, ackBody("cmd-a", Long.parseLong(revision))).statusCode(200).body("status", equalTo("ok"))
                .body("value.order.tasks[0].status", equalTo("complete"))
                .body("value.order.tasks[0].actionable", equalTo(false)).body(not(containsString(a)));
        get(a, "").statusCode(200).body("value.orders[0].items[0].status", equalTo("complete"))
                .body("value.orders[0].items[0].acknowledgement.kind", equalTo("synthetic-acknowledgement"));
        post(a, ackBody("cmd-a2", Long.parseLong(revision) + 2)).statusCode(409)
                .body("code", equalTo("task-not-waiting"));
    }

    @Test
    void badRequestsAreRejectedWithTheField() throws Exception {
        String a = token("sub-employee-a", "employee");
        get(a, "?employeeId=E-1002").statusCode(400).body("code", equalTo("unsupported-query"));
        get(a, "/readiness?orderUuid=" + order + "&x=1").statusCode(400).body("code", equalTo("unsupported-query"));
        get(a, "/readiness").statusCode(400).body("code", equalTo("invalid-document-command"));
        post(a, "{\"orderUuid\":\"" + order + "\",\"itemId\":\"" + ITEM + "\",\"expectedDocumentsRevision\":1}")
                .statusCode(400).body("reasons[0].field", equalTo("commandId"));
        post(a, "not json").statusCode(400);
    }
}
