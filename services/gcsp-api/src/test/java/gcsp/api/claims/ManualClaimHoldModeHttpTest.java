package gcsp.api.claims;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.ClaimCompositionSeed;
import gcsp.api.account.StockDbFixture;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.WallPolicyClock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
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
import org.junit.jupiter.api.Test;

/**
 * FUCQ-518: a claim's hold.mode is the draft's journey (new or replacement), as Angular's manual page requires, while
 * manual_claims.mode stays the claim adapter. Started app, real RS256 JWTs, native PostgreSQL, real ordering bean.
 */
@QuarkusTest
@TestProfile(ClaimHoldModeProfile.class)
class ManualClaimHoldModeHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String BASE = "/api/gcsp/v1/manual/";
    private static final String U = StockDbFixture.UUID_PREFIX;
    private static final Instant T0 = Instant.parse(ClaimCompositionSeed.ACCOUNT_NOW);
    private static final Path OUT = Path.of("target", "fucq518");
    private static String ownedSchema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    /** The only replaced bean: the wall clock, pinned to the account fixture's instant. */
    static final class Clock extends WallPolicyClock {
        @Override
        public Instant now(RunContext context) {
            return T0;
        }
    }

    record Resp(int status, JsonNode body) {
        JsonNode value() {
            return body.path("value");
        }

        JsonNode hold() {
            return body.path("value").path("hold");
        }
    }

    @BeforeEach
    void seed() throws Exception {
        ownedSchema = schema;
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        QuarkusMock.installMockForType(new Clock(), WallPolicyClock.class);
        clean();
        try (Connection c = dataSource.get().getConnection()) {
            StockDbFixture.insertStock(c, ClaimCompositionSeed.ENV, ClaimCompositionSeed.RUN, StockDbFixture.rows());
        }
        saveDraft("sub-paula", "paula");
        saveDraft("sub-jordan", "jordan");
        Files.createDirectories(OUT);
    }

    @AfterAll
    static void dropSchema() throws Exception {
        ClaimCompositionSeed.dropSchema(ownedSchema);
    }

    @Test
    void aReplacementJourneyClaimShowsReplacementOnEveryHoldAndMatchesItsReviewDetails() throws Exception {
        Resp claimed = post("sub-paula", "claim", claimInput("sub-paula", U + "1"));
        assertEquals(200, claimed.status(), claimed.body().toString());
        Resp read = get("sub-paula", "claim");
        Resp quote = get("sub-paula", "quote");
        Resp reviewed = post("sub-paula", "claim/review", action(claimed.hold()));
        assertEquals(200, reviewed.status(), reviewed.body().toString());
        Resp details = get("sub-paula", "review-details");
        assertEquals(200, details.status(), details.body().toString());
        write("claim-post", claimed);
        write("claim-get", read);
        write("quote-get", quote);
        write("review-post", reviewed);
        write("review-details-get", details);

        for (Resp r : List.of(claimed, read, quote, reviewed)) {
            assertEquals(200, r.status());
            assertHoldShape(r.hold());
            assertEquals("replacement", r.hold().get("mode").asText());
        }
        assertEquals("replacement", details.value().get("mode").asText());
        assertEquals("replacement", details.value().at("/hold/mode").asText());
        assertEquals("order-review", reviewed.hold().get("phase").asText());
        assertEquals("local", text("SELECT mode FROM manual_claims WHERE order_uuid = ?", U + "1"));
    }

    @Test
    void aNewJourneyClaimShowsNew() throws Exception {
        assertEquals(200, post("sub-jordan", "claim", claimInput("sub-jordan", U + "3")).status());
        Resp read = get("sub-jordan", "claim");
        assertEquals(200, read.status(), read.body().toString());
        write("claim-get-new", read);
        assertHoldShape(read.hold());
        assertEquals("new", read.hold().get("mode").asText());
    }

    /** The fields Angular's manualSelection() reads from the hold. */
    private static void assertHoldShape(JsonNode h) {
        for (String k : List.of("holdId", "orderUuid", "employeeId", "entitlementSlotId", "type", "state", "phase")) {
            assertTrue(h.path(k).isTextual() && !h.get(k).asText().isBlank(), k);
        }
        assertEquals("cart", h.get("type").asText());
        assertTrue(h.path("version").asLong() > 0);
        assertTrue(h.path("expiresAt").asText().endsWith("Z"), h.toString());
        assertTrue(Instant.parse(h.get("expiresAt").asText()) != null);
        JsonNode started = h.path("reviewStartedAt");
        assertTrue(started.isNull() || Instant.parse(started.asText()) != null && started.asText().endsWith("Z"), h.toString());
        assertTrue(h.has("releaseReason") && (h.get("releaseReason").isNull() || h.get("releaseReason").isTextual()), h.toString());
        assertFalse(h.path("mode").isMissingNode());
    }

    private static void write(String name, Resp r) throws Exception {
        Files.writeString(OUT.resolve(name + ".json"), JSON.writeValueAsString(r.value()));
    }

    private static String cid() {
        return "hm-" + UUID.randomUUID();
    }

    private String token(String sub) throws Exception {
        return ClaimCompositionSeed.token(signingJwk, sub);
    }

    private Resp get(String sub, String route) throws Exception {
        var r = given().header("Authorization", "Bearer " + token(sub)).when().get(BASE + route).then().extract();
        return new Resp(r.statusCode(), JSON.readTree(r.asString()));
    }

    private Resp post(String sub, String route, JsonNode body) throws Exception {
        var r = given().header("Authorization", "Bearer " + token(sub)).contentType("application/json").body(body.toString())
                .when().post(BASE + route).then().extract();
        return new Resp(r.statusCode(), JSON.readTree(r.asString()));
    }

    private void saveDraft(String sub, String who) throws Exception {
        ObjectNode choices = StockDbFixture.complete();
        choices.put("slotId", "slot-" + who).put("driverId", "driver:employee-" + who);
        if ("paula".equals(who)) choices.put("oldContractId", "current:employee-paula");
        else choices.put("mode", "new").remove(List.of("oldContractId", "expectedReturnMileage"));
        ((ObjectNode) choices.get("contact")).put("email", who + "@gcsp-demo.com");
        String ctx = get(sub, "account").value().get("contextVersion").asText();
        ObjectNode in = JSON.createObjectNode().put("commandId", cid()).put("expectedDraftVersion", 0)
                .put("expectedContextVersion", ctx);
        in.set("choices", choices);
        Resp saved = post(sub, "draft", in);
        assertEquals(200, saved.status(), saved.body().toString());
    }

    /** The browse's own claim input for an eligible car, which is what the app tells the client to send. */
    private ObjectNode claimInput(String sub, String car) throws Exception {
        Resp stock = get(sub, "stock");
        assertEquals(200, stock.status(), stock.body().toString());
        for (JsonNode d : stock.value().get("decisions")) {
            if (car.equals(d.get("orderUuid").asText())) {
                assertEquals("eligible", d.get("gateStatus").asText(), d.toString());
                ObjectNode in = ((ObjectNode) d.get("claimInput")).deepCopy();
                in.put("commandId", cid());
                return in;
            }
        }
        throw new AssertionError(car + " is not in the browse");
    }

    private static ObjectNode action(JsonNode hold) {
        return JSON.createObjectNode().put("commandId", cid()).put("holdId", hold.get("holdId").asText())
                .put("expectedHoldVersion", hold.get("version").asLong()).put("expectedDraftVersion", 1);
    }

    private void clean() throws Exception {
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
    }

    private String text(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }
}
