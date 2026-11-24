package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static gcsp.api.appointments.ApptHttp.body;
import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.StockDbFixture;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.function.Executable;
import org.postgresql.ds.PGSimpleDataSource;

/** F572: the shipped Greg keeps operator reads alongside his separate, owned employee account. */
@QuarkusTest
@TestProfile(LifecycleMixedRoleHttpTest.Profile.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class LifecycleMixedRoleHttpTest {

    /** A private schema over the same real-port composition; shared test profiles stay unchanged. */
    public static class Profile extends ReturnJourneyProfile {
        static final String SCHEMA = "gcsp_s_mixedrole_" + Long.toHexString(System.nanoTime());

        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> m = new HashMap<>(super.getConfigOverrides());
            try {
                ArrayNode accounts = (ArrayNode) ApptHttp.JSON.readTree(m.get("gcsp.oidc.accounts"));
                var greg = accounts.addObject();
                greg.put("subject", "sub-greg-dual");
                greg.putArray("roles").add("greg").add("employee");
                greg.put("employeeId", "operator-greg");
                m.put("gcsp.oidc.accounts", accounts.toString());
            } catch (Exception e) {
                throw new IllegalStateException("Invalid inherited test account configuration", e);
            }
            if ("true".equals(m.get("quarkus.datasource.active"))) {
                m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
                m.put("quarkus.flyway.schemas", SCHEMA);
                m.put("quarkus.flyway.default-schema", SCHEMA);
            }
            return m;
        }
    }

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    @Inject
    AgroalDataSource dataSource;

    private ApptHttp http;
    private ReturnJourneySteps journey;
    private String alexOrder;
    private JsonNode scheduled;
    private RsaJsonWebKey key;
    private String ownedSchema;
    private boolean prepared;

    @BeforeEach
    void prepareRealOrdersAndHandover() throws Exception {
        if (journey != null) {
            assertTrue(prepared, "shared fixture setup failed; see the first test's failure");
            return;
        }
        assertTrue(persistence.active(), "F572 requires the configured native PostgreSQL composition");
        ownedSchema = schema;
        assertTrue(ownedSchema.matches("gcsp_s_mixedrole_[0-9a-f]+"), "only the configured owned schema is used");
        key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        http = new ApptHttp(signingJwk);
        journey = new ReturnJourneySteps(http, dataSource, persistence);

        JsonNode identity = value(mixed().get(BASE + "/context"));
        Set<String> roles = new java.util.HashSet<>();
        identity.get("roles").forEach(r -> roles.add(r.asText()));
        assertEquals(Set.of("greg", "employee"), roles);
        assertEquals("operator-greg", identity.get("employeeId").asText());
        assertEquals("sub-greg-dual", identity.get("subject").asText());

        // F581 supplies scoped run time to claims and ordering; use the actual unmodified scenario clock.
        // The released input includes an X1 eligible for Alex's grade, as in DocumentsJourneySupport.
        seedReleasedStock();
        alexOrder = journey.placeOrder("alex");
        journey.order = placePaulaOrder(alexOrder);
        assertFalse(alexOrder.equals(journey.order));
        journey.t0 = Instant.parse(journey.clock().get("now").asText());
        journey.tick();
        journey.requestHandover();
        scheduled = journey.scheduleHandover();

        // The employee's real acknowledgement and provider ticks make the handover genuinely ready.
        JsonNode documents = value(http.as("paula").get(BASE + "/documents")).get("orders");
        JsonNode paulaDocuments = null;
        for (JsonNode order : documents) {
            if (journey.order.equals(order.path("orderUuid").asText())) paulaDocuments = order;
        }
        assertTrue(paulaDocuments != null, "the actual documents order must be open");
        Response ack = http.as("paula").body("{\"commandId\":\"mixed-ack-" + ApptHttp.id()
                + "\",\"orderUuid\":\"" + journey.order
                + "\",\"itemId\":\"agreement-acknowledgement\",\"expectedDocumentsRevision\":"
                + paulaDocuments.get("documentsRevision").asLong() + "}")
                .post(BASE + "/documents/tasks/acknowledge");
        assertEquals(200, ack.statusCode(), ack.asString());
        journey.advanceAndTick(journey.t1.plusSeconds(86_401));
        journey.advanceAndTick(journey.t1.plusSeconds(172_801));
        assertTrue(value(http.as("paula").get(readiness(journey.order))).get("ready").asBoolean());
        journey.advanceAndTick(journey.slotStart);
        prepared = true;
    }

    @AfterAll
    void dropOwnedSchema() throws Exception {
        if (ownedSchema == null || !ownedSchema.matches("gcsp_s_mixedrole_[0-9a-f]+")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    @Test
    void mixedRoleGregReadsBothEmployeesAtEveryLifecycleBoundaryWithoutWriting() throws Exception {
        Map<String, String> before = storedState();
        List<Executable> reads = new ArrayList<>();
        for (var owner : Map.of("paula", journey.order, "alex", alexOrder).entrySet()) {
            String who = owner.getKey();
            String order = owner.getValue();
            reads.add(() -> {
                JsonNode progress = value(mixed().get(BASE + "/orders/progress?orderUuid=" + order));
                assertEquals(order, progress.get("orderUuid").asText());
                assertEquals("employee-" + who, progress.get("employeeId").asText());
                Set<String> outcomes = "paula".equals(who) ? Set.of("sent-to-ordering", "handed-over")
                        : Set.of("sent-to-ordering");
                assertTrue(outcomes.contains(progress.get("outcome").asText()), progress.toString());
                assertTrue(progress.get("stages").size() > 0);
            });
            reads.add(() -> {
                JsonNode documents = value(mixed().get(readiness(order)));
                assertEquals(order, documents.get("orderUuid").asText());
                assertTrue(documents.get("opened").asBoolean());
                assertTrue(documents.get("documentsRevision").asLong() > 0);
                assertEquals("paula".equals(who), documents.get("ready").asBoolean());
            });
            reads.add(() -> {
                JsonNode appointment = value(mixed().get(appointment(order)));
                assertEquals(order, appointment.get("orderUuid").asText());
                assertEquals("employee-" + who, appointment.get("employeeId").asText());
                // The independent completion regression may already have completed Paula's handover.
                Set<String> states = "paula".equals(who) ? Set.of("scheduled", "completed") : Set.of("not-requested");
                assertTrue(states.contains(appointment.get("state").asText()), appointment.toString());
                assertFalse(appointment.get("nextStep").asText().isBlank());
            });
            reads.add(() -> {
                JsonNode plan = value(mixed().get(plan(order)));
                assertEquals(order, plan.get("orderUuid").asText());
                assertEquals("current:employee-" + who, plan.get("oldContractId").asText());
                assertEquals("not-planned", plan.get("state").asText());
                assertFalse(plan.get("source").get("reference").asText().isBlank());
            });
        }
        reads.add(() -> {
            JsonNode all = value(mixed().get(BASE + "/orders/progress/all"));
            Set<String> orders = new java.util.HashSet<>();
            all.get("orders").forEach(o -> orders.add(o.get("orderUuid").asText()));
            assertTrue(orders.containsAll(Set.of(journey.order, alexOrder)), all.toString());
        });
        try {
            assertAll("both-role operator reads actual Paula and Alex projections", reads);
        } finally {
            assertEquals(before, storedState(), "shared reads must not write domain or command records");
        }
    }

    @Test
    void employeeOnlyForeignReadsRemainForbiddenAtEveryLifecycleBoundary() throws Exception {
        Map<String, String> before = storedState();
        for (var foreign : Map.of("alex", journey.order, "paula", alexOrder).entrySet()) {
            String order = foreign.getValue();
            for (String route : List.of(BASE + "/orders/progress?orderUuid=" + order,
                    readiness(order), appointment(order), plan(order))) {
                Response denied = http.as(foreign.getKey()).get(route);
                assertEquals(403, denied.statusCode(), route + denied.asString());
                assertEquals("forbidden", body(denied).get("status").asText());
                assertFalse(body(denied).has("value"), route);
            }
        }
        assertEquals(before, storedState(), "foreign read refusals must leave every stored record unchanged");
    }

    @Test
    void mixedRoleOperatorDoesNotBecomeTheForeignEmployeesCommandOwner() throws Exception {
        Map<String, String> before = storedState();
        String order = journey.order;
        List<String[]> commands = List.of(
                new String[] {"/documents/tasks/acknowledge", "{\"commandId\":\"denied-" + ApptHttp.id()
                        + "\",\"orderUuid\":\"" + order + "\",\"itemId\":\"agreement-acknowledgement\",\"expectedDocumentsRevision\":1}"},
                new String[] {"/appointments/request", "{\"commandId\":\"denied-" + ApptHttp.id()
                        + "\",\"orderUuid\":\"" + order + "\",\"slotId\":\"" + journey.handoverSlot + "\",\"expectedVersion\":0}"},
                new String[] {"/appointments/accept", "{\"commandId\":\"denied-" + ApptHttp.id()
                        + "\",\"orderUuid\":\"" + order + "\",\"proposalId\":\"other-proposal\",\"expectedVersion\":1}"},
                new String[] {"/return-plan/request", ReturnJourneySteps.requestJson("denied-" + ApptHttp.id(), order,
                        "same-visit", journey.handoverSlot, 0)},
                new String[] {"/return-plan/accept", ReturnJourneySteps.acceptJson("denied-" + ApptHttp.id(), order,
                        "other-proposal", 1)});
        for (String[] command : commands) {
            Response denied = mixed().body(command[1]).post(BASE + command[0]);
            assertEquals(403, denied.statusCode(), command[0] + denied.asString());
            assertFalse(body(denied).has("value"), command[0]);
        }
        assertEquals(before, storedState(), "operator read authority must not grant employee-owned writes");
    }

    @Test
    void mixedRoleCompletionReturnsItsRealReadbackAndReplaysOnlyOnce() throws Exception {
        String command = "{\"commandId\":\"mixed-complete-" + ApptHttp.id() + "\",\"orderUuid\":\""
                + journey.order + "\",\"expectedVersion\":" + scheduled.get("version").asLong() + "}";
        Response completed = mixed().body(command).post(BASE + "/appointments/complete");
        JsonNode actual = value(completed);
        assertEquals(journey.order, actual.get("orderUuid").asText());
        assertEquals("employee-paula", actual.get("employeeId").asText());
        assertEquals("completed", actual.get("state").asText());
        assertFalse(actual.get("outcome").get("providerReference").asText().isBlank());
        assertEquals(actual, value(mixed().get(appointment(journey.order))));
        Map<String, String> once = storedState();
        Response replay = mixed().body(command).post(BASE + "/appointments/complete");
        assertEquals(completed.asString(), replay.asString());
        assertEquals(once, storedState(), "the same completion must not duplicate any outcome or receipt");
        assertEquals(1, journey.count("SELECT count(*) FROM outbox_events WHERE event_type = 'appointment-completed' "
                + "AND payload->>'orderUuid' = ?", journey.order));
    }

    private RequestSpecification mixed() throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(ApptHttpProfiles.ISSUER);
        c.setAudience(ApptHttpProfiles.AUDIENCE);
        c.setSubject("sub-greg-dual");
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", ApptHttpProfiles.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of("greg", "employee")));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return given().header("Authorization", "Bearer " + jws.getCompactSerialization()).contentType("application/json");
    }

    private static JsonNode value(Response r) throws Exception {
        assertEquals(200, r.statusCode(), r.asString());
        JsonNode b = body(r);
        assertEquals("ok", b.get("status").asText(), r.asString());
        return b.get("value");
    }

    private static String readiness(String order) { return BASE + "/documents/readiness?orderUuid=" + order; }
    private static String appointment(String order) { return BASE + "/appointments?orderUuid=" + order; }
    private static String plan(String order) { return BASE + "/return-plan?orderUuid=" + order; }

    private void seedReleasedStock() throws Exception {
        var run = persistence.guard().currentRun();
        List<JsonNode> rows = new ArrayList<>(StockDbFixture.rows());
        ObjectNode extra = rows.get(0).deepCopy();
        String id = StockDbFixture.UUID_PREFIX + "9";
        extra.put("orderUuid", id).put("orderNumber", "1000009");
        ((ObjectNode) extra.get("facts").get("sourceKeys")).put("stockId", id);
        ((ObjectNode) extra.get("facts").get("facts").get("eligibilityModelKey")).put("value", "U11 X1|20i");
        rows.add(extra);
        try (Connection c = dataSource.getConnection()) {
            StockDbFixture.insertStock(c, run.environmentId(), run.runId(), rows);
        }
    }

    /** The same real ordering route as ReturnJourneySteps, choosing a different car from Alex's order. */
    private String placePaulaOrder(String excludedCar) throws Exception {
        JsonNode account = value(http.as("paula").get(BASE + "/manual/account"));
        assertEquals("ready", account.get("state").asText());
        ObjectNode choices = ReturnJourneySteps.withCollectionDate(account, StockDbFixture.complete());
        value(http.as("paula").body("{\"commandId\":\"mixed-draft-" + ApptHttp.id()
                + "\",\"expectedDraftVersion\":0,\"expectedContextVersion\":\""
                + account.get("contextVersion").asText() + "\",\"choices\":" + choices + "}")
                .post(BASE + "/manual/draft"));
        ObjectNode input = null;
        JsonNode stock = value(http.as("paula").get(BASE + "/manual/stock"));
        for (JsonNode decision : stock.get("decisions")) {
            if ("eligible".equals(decision.path("gateStatus").asText())
                    && !excludedCar.equals(decision.path("claimInput").path("orderUuid").asText())) {
                input = ((ObjectNode) decision.get("claimInput")).deepCopy();
                break;
            }
        }
        assertTrue(input != null, "a distinct eligible released car must be available for Paula");
        String car = input.get("orderUuid").asText();
        input.put("commandId", "mixed-claim-" + ApptHttp.id());
        JsonNode held = value(http.as("paula").body(input.toString()).post(BASE + "/manual/claim")).get("hold");
        JsonNode reviewed = value(http.as("paula").body("{\"commandId\":\"mixed-review-" + ApptHttp.id()
                + "\",\"holdId\":\"" + held.get("holdId").asText() + "\",\"expectedHoldVersion\":"
                + held.get("version").asLong() + ",\"expectedDraftVersion\":1}").post(BASE + "/manual/claim/review"));
        String terms = value(http.as("paula").get(BASE + "/manual/order/terms")).get("termsDigest").asText();
        String request = "{\"commandId\":\"mixed-order-" + ApptHttp.id()
                + "\",\"source\":{\"type\":\"cart\",\"holdId\":\"" + held.get("holdId").asText()
                + "\",\"expectedHoldVersion\":" + reviewed.get("hold").get("version").asLong()
                + ",\"expectedDraftVersion\":1},\"expectedQuoteId\":\"" + reviewed.get("quote").get("quoteId").asText()
                + "\",\"expectedStockVersion\":" + reviewed.get("quote").get("stockVersion").asLong()
                + ",\"termsDigest\":\"" + terms
                + "\",\"declarations\":{\"terms\":true,\"driver\":true,\"return\":true}}";
        JsonNode ordered = value(http.as("paula").body(request).post(BASE + "/manual/order"));
        assertEquals("acknowledged", ordered.get("status").asText());
        assertEquals(car, ordered.get("selection").get("orderUuid").asText());
        return car;
    }

    /** Hash complete small owned tables so updates, deletes and inserted refusal receipts are all observable. */
    private Map<String, String> storedState() throws Exception {
        Map<String, String> hashes = new LinkedHashMap<>();
        try (Connection c = dataSource.getConnection(); Statement s = c.createStatement()) {
            for (String table : List.of("selection_orders", "appointments", "appointment_history", "document_orders",
                    "document_items", "return_plans", "current_car_relationships", "pending_operations", "command_receipts",
                    "outbox_events", "synthetic_appointment_receipts", "return_provider_receipts")) {
                try (ResultSet rs = s.executeQuery("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]') FROM "
                        + table + " t")) {
                    assertTrue(rs.next());
                    byte[] digest = MessageDigest.getInstance("SHA-256").digest(rs.getString(1).getBytes(StandardCharsets.UTF_8));
                    hashes.put(table, HexFormat.of().formatHex(digest));
                }
            }
        }
        return hashes;
    }
}
