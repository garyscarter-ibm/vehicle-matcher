package gcsp.api.claims;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.ClaimCompositionSeed;
import gcsp.api.account.StockDbFixture;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.remote.RemoteOperationServer;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;

/** Shared plumbing for the remote-stock composed tests: real JWTs, HTTP calls, SQL reads, the pinned clock and the loopback server. */
abstract class RemoteClaimComposedSupport {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String BASE = "/api/gcsp/v1/manual/";
    static final Instant T0 = Instant.parse(ClaimCompositionSeed.ACCOUNT_NOW);
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
    ClaimSweep sweep;

    @RemoteClaimStockResource.InjectRemote
    RemoteOperationServer remote;

    Clock clock;

    /** The only replaced bean: the claim-clock port, pinned so the test decides when a claim is due. */
    static final class Clock implements ClaimClock {
        volatile Instant now = T0;

        @Override
        public Instant now(RunContext context) {
            return now;
        }
    }

    record Resp(int status, JsonNode body) {
        String code() {
            return body.path("code").asText();
        }

        String state() {
            return body.path("status").asText();
        }

        JsonNode hold() {
            return body.path("value").path("hold");
        }
    }

    @BeforeEach
    void pinClock() {
        ownedSchema = schema;
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        assertNotNull(remote, "the loopback stock server was not injected into the test");
        clock = new Clock();
        QuarkusMock.installMockForType(clock, ClaimClock.class);
    }

    @AfterAll
    static void dropSchema() throws Exception {
        ClaimCompositionSeed.dropSchema(ownedSchema);
    }

    static String cid(String prefix) {
        return prefix + "-" + UUID.randomUUID();
    }

    String token(String sub) throws Exception {
        return ClaimCompositionSeed.token(signingJwk, sub);
    }

    Resp get(String sub, String route) throws Exception {
        var r = given().header("Authorization", "Bearer " + token(sub)).when().get(BASE + route).then().extract();
        return new Resp(r.statusCode(), JSON.readTree(r.asString()));
    }

    Resp post(String sub, String route, JsonNode body) throws Exception {
        var r = given().header("Authorization", "Bearer " + token(sub)).contentType("application/json")
                .body(body.toString()).when().post(BASE + route).then().extract();
        return new Resp(r.statusCode(), JSON.readTree(r.asString()));
    }

    long count(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0;
            }
        }
    }

    String text(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    /** Every row the remote path can change, as one comparable string (holds, operations, car versions, run revision). */
    String snapshot() throws Exception {
        return text("SELECT coalesce((SELECT string_agg(hold_id || ':' || state || ':' || version || ':' || coalesce(operation_id, '-'), ',' "
                + "ORDER BY hold_id) FROM custody_holds), '') || '|' || coalesce((SELECT string_agg(operation_id || ':' || state "
                + "|| ':' || version || ':' || attempts, ',' ORDER BY operation_id) FROM pending_operations), '') || '|' "
                + "|| coalesce((SELECT string_agg(order_uuid || ':' || version, ',' ORDER BY order_uuid) FROM stock_cars), '') "
                + "|| '|' || (SELECT max(revision) FROM runs)");
    }

    // ---- seeding and inputs (same shapes as ManualClaimsComposedHttpTest) ----

    /** Wipes the run's claim, order and stock rows, then seeds the stock and one saved draft each for paula and jordan. */
    void seedStockAndDrafts() throws Exception {
        try (Connection c = dataSource.get().getConnection(); Statement st = c.createStatement()) {
            try {
                // Immutable and guarded tables are cleared with triggers and foreign keys off for this session only.
                st.execute("SET session_replication_role = replica");
                for (String t : List.of("selection_orders", "ordering_synthetic_receipts", "ordering_reference_counters",
                        "pending_operations", "manual_claim_operations", "manual_review_freezes", "manual_review_details",
                        "manual_claims", "custody_holds", "manual_drafts", "stock_cars", "outbox_events", "command_receipts")) {
                    st.execute("DELETE FROM " + t);
                }
            } finally {
                st.execute("RESET session_replication_role");
            }
        }
        try (Connection c = dataSource.get().getConnection()) {
            StockDbFixture.insertStock(c, ClaimCompositionSeed.ENV, ClaimCompositionSeed.RUN, StockDbFixture.rows());
        }
        saveDraft("sub-paula", "paula");
        saveDraft("sub-jordan", "jordan");
    }

    private void saveDraft(String sub, String who) throws Exception {
        ObjectNode choices = StockDbFixture.complete();
        choices.put("slotId", "slot-" + who).put("driverId", "driver:employee-" + who);
        if ("paula".equals(who)) choices.put("oldContractId", "current:employee-paula");
        else choices.put("mode", "new").remove(List.of("oldContractId", "expectedReturnMileage"));
        ((ObjectNode) choices.get("contact")).put("email", who + "@gcsp-demo.com");
        String ctx = get(sub, "account").body().path("value").get("contextVersion").asText();
        ObjectNode in = JSON.createObjectNode().put("commandId", cid("draft-" + who)).put("expectedDraftVersion", 0)
                .put("expectedContextVersion", ctx);
        in.set("choices", choices);
        Resp saved = post(sub, "draft", in);
        assertEquals(200, saved.status(), saved.toString());
    }

    /** The browse's own claim input for an eligible car, which is what the app tells the client to send. */
    ObjectNode claimInput(String sub, String car, String commandId) throws Exception {
        Resp stock = get(sub, "stock");
        assertEquals(200, stock.status(), stock.toString());
        JsonNode d = null;
        for (JsonNode x : stock.body().path("value").get("decisions")) if (car.equals(x.get("orderUuid").asText())) d = x;
        assertNotNull(d, car + " is in the browse");
        assertEquals("eligible", d.get("gateStatus").asText(), sub + " is shown " + car + " as eligible");
        ObjectNode in = ((ObjectNode) d.get("claimInput")).deepCopy();
        in.put("commandId", commandId);
        return in;
    }

    static ObjectNode releaseBody(JsonNode hold, String reason, String commandId) {
        return JSON.createObjectNode().put("commandId", commandId).put("holdId", hold.get("holdId").asText())
                .put("expectedHoldVersion", hold.get("version").asLong()).put("expectedDraftVersion", 1).put("reason", reason);
    }

    long stockVersion(String car) throws Exception {
        return count("SELECT version FROM stock_cars WHERE order_uuid = ?", car);
    }

    long occupying(String car) throws Exception {
        return count("SELECT count(*) FROM custody_holds WHERE order_uuid = ? AND state IN "
                + "('active', 'claim-pending', 'release-pending', 'selection-pending')", car);
    }

    String holdState(String car) throws Exception {
        return text("SELECT state FROM custody_holds WHERE order_uuid = ?", car);
    }

    String opState(String operationId) throws Exception {
        return text("SELECT state FROM pending_operations WHERE operation_id = ?", operationId);
    }

    /**
     * The rival is refused with 409 and nothing changes: the browse no longer offers a held car, so the claim ends as
     * car-not-eligible-or-available (car-held is the same refusal from the unique hold index when two claims race).
     */
    void assertRivalRefused(ObjectNode rivalInput, String car) throws Exception {
        long holds = count("SELECT count(*) FROM custody_holds");
        int requests = remote.requests().size();
        ObjectNode in = rivalInput.deepCopy();
        in.put("commandId", cid("rival"));
        in.put("expectedStockVersion", stockVersion(car));
        Resp r = post("sub-jordan", "claim", in);
        assertEquals(409, r.status(), r.toString());
        assertTrue(List.of("car-held", "car-not-eligible-or-available").contains(r.code()), r.code());
        assertEquals(holds, count("SELECT count(*) FROM custody_holds"));
        assertEquals(requests, remote.requests().size(), "a refused rival reaches the stock authority with nothing");
    }
}
