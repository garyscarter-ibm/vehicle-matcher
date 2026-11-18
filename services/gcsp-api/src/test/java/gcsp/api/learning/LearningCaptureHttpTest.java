package gcsp.api.learning;

import static gcsp.api.allocation.BuddyJourneySupport.API;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.allocation.BuddyJourneySupport.post;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySeed;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.identity.Principal;
import gcsp.api.offers.OfferJourneyProfiles;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** Actual signed-in presenter/allocation/employee producers, followed by the production read-only learning port. */
@QuarkusTest
@TestProfile(LearningCaptureHttpTest.Profile.class)
class LearningCaptureHttpTest {

    /** Existing real composition; no enabled alternatives and no learning test endpoints. */
    public static class Profile extends OfferJourneyProfiles.Accept {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> config = new HashMap<>(super.getConfigOverrides());
            String accounts = config.get("gcsp.oidc.accounts");
            config.put("gcsp.oidc.accounts", accounts.substring(0, accounts.length() - 1)
                    + ",{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]}]");
            return config;
        }
    }

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    BearerAuthentication authentication;

    @Inject
    LearningRecordService records;

    @Inject
    LearningOutcomeRows outcomeRows;

    @Test
    void realNewRunExposureAndDeclineKeepTheirSavedProvenance() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String bruno = s.token("sub-bruno", "employee");
        String paula = s.token("sub-paula", "employee");
        String greg = s.token("sub-greg", "greg");
        get(greg, API + "/context").then().statusCode(200);
        Principal principal = authentication.authenticate("Bearer " + greg);

        assertEquals("completed", s.tick(presenter, "learning-capture-allocate").path("state").asText());
        String offer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", BuddyJourneySeed.BRUNO);
        String quote = s.text("SELECT quote_id FROM buddy_offers WHERE offer_id = ?", offer);
        String offeredAt = s.text("SELECT to_char(quoted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') "
                + "FROM buddy_quotes WHERE quote_id = ?", quote);
        LearningRecordResult before = records.readRecords(principal);
        assertTrue(before.ok(), before.body().toString());
        JsonNode exposure = record(before, offer);
        assertEquals("known", before.value().path("outcomeSources").path("status").asText());
        assertEquals("offered", exposure.path("outcomes").path("offered").path("state").asText());
        assertEquals(offeredAt, exposure.path("outcomes").path("offered").path("at").asText());
        assertEquals("known", exposure.path("terms").path("status").asText());
        assertEquals(offeredAt, exposure.path("terms").path("value").path("quotedAt").asText());
        assertEquals("unknown", exposure.path("choiceSet").path("status").asText());
        assertEquals("unknown", exposure.path("outcomes").path("satisfaction").path("state").asText());
        assertEquals("observed", exposure.path("provenance").path("kind").asText());
        assertSavedPendingIntentTimeIsRetained();

        String path = API + "/offers/" + offer;
        JsonNode view = body(get(bruno, path).then().statusCode(200).extract().asString()).get("value");
        JsonNode reasons = body(get(bruno, path + "/decision-reasons").then().statusCode(200).extract().asString()).get("value");
        String reason = reasons.path("reasons").get(0).path("code").asText();
        ObjectNode command = BuddyJourneySupport.JSON.createObjectNode().put("commandId", "learning-decline-1")
                .put("decision", "decline").put("reasonCode", reason)
                .put("expectedOfferVersion", view.path("offerVersion").asLong())
                .put("expectedHoldVersion", view.path("holdVersion").asLong())
                .put("runId", "run-1").put("expectedQuoteVersion", view.at("/quote/revisions/quote").asLong());
        JsonNode declined = body(post(bruno, path + "/decision", command.toString())
                .then().statusCode(200).extract().asString()).get("value");
        String decidedAt = declined.path("serverNow").asText();
        assertFalse(decidedAt.isBlank());

        String acceptedOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", BuddyJourneySeed.PAULA);
        String acceptedPath = API + "/offers/" + acceptedOffer;
        JsonNode accepting = body(get(paula, acceptedPath).then().statusCode(200).extract().asString()).get("value");
        String digest = body(get(paula, API + "/manual/order/terms").then().statusCode(200).extract().asString())
                .path("value").path("termsDigest").asText();
        ObjectNode accept = BuddyJourneySupport.JSON.createObjectNode().put("commandId", "learning-accept-1")
                .put("decision", "accept").put("termsDigest", digest).put("expectedReturnMileage", 5400)
                .put("expectedOfferVersion", accepting.path("offerVersion").asLong())
                .put("expectedHoldVersion", accepting.path("holdVersion").asLong())
                .put("runId", "run-1").put("expectedQuoteVersion", accepting.at("/quote/revisions/quote").asLong());
        accept.putObject("declarations").put("terms", true).put("driver", true).put("return", true);
        JsonNode accepted = body(post(paula, acceptedPath + "/decision", accept.toString())
                .then().statusCode(200).extract().asString()).get("value");

        s.advance(presenter, 60);
        String now = s.clockNow(presenter);
        long clockVersion = s.clockVersion(presenter);
        long revision = s.count("SELECT revision FROM runs WHERE run_id = ?", BuddyJourneySeed.RUN);
        LearningRecordResult after = records.readRecords(principal);
        assertTrue(after.ok(), after.body().toString());
        JsonNode observed = record(after, offer);
        assertEquals("declined", observed.path("outcomes").path("decline").path("state").asText());
        assertEquals(decidedAt, observed.path("outcomes").path("decline").path("at").asText());
        assertEquals(reason, observed.path("outcomes").path("decline").path("reasonType").asText());
        assertEquals(offeredAt, observed.path("outcomes").path("offered").path("at").asText());
        assertEquals(now, observed.path("timestamps").path("projectedAt").asText());
        assertEquals(clockVersion, observed.path("timestamps").path("clockVersion").asLong());
        JsonNode selected = record(after, acceptedOffer);
        assertEquals("accepted", selected.path("outcomes").path("acceptance").path("state").asText());
        assertEquals(accepted.path("serverNow"), selected.path("outcomes").path("acceptance").path("at"));
        assertEquals("selected", selected.path("outcomes").path("selection").path("state").asText());
        assertEquals(accepted.path("serverNow"), selected.path("outcomes").path("selection").path("at"));
        assertEquals(revision, s.count("SELECT revision FROM runs WHERE run_id = ?", BuddyJourneySeed.RUN));
        assertEquals(1, s.count("SELECT count(*) FROM offer_decisions WHERE offer_id = ?", offer));
        assertEquals("forbidden", records.readRecords(authentication.authenticate("Bearer " + bruno)).status());
        assertSourceReadBounds();
    }

    /** A rolled-back mapping fixture covers the actual remote-intent payload shape; it is not live-provider evidence. */
    private void assertSavedPendingIntentTimeIsRetained() throws Exception {
        String pendingAt = "2026-04-05T06:07:08.000Z";
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            try {
                try (var ps = c.prepareStatement("INSERT INTO pending_operations (environment_id, run_id, operation_id, "
                        + "operation_type, idempotency_key, input_digest, state) VALUES (?, ?, 'learning-pending-intent', "
                        + "'offer-selection', 'learning-pending-intent', ?, 'pending')")) {
                    ps.setString(1, BuddyJourneySeed.ENV);
                    ps.setString(2, BuddyJourneySeed.RUN);
                    ps.setString(3, "0".repeat(64));
                    ps.executeUpdate();
                }
                String hold;
                try (var ps = c.prepareStatement("SELECT hold_id FROM buddy_offers WHERE environment_id = ? AND run_id = ? "
                        + "AND employee_id = ?")) {
                    ps.setString(1, BuddyJourneySeed.ENV);
                    ps.setString(2, BuddyJourneySeed.RUN);
                    ps.setString(3, BuddyJourneySeed.PAULA);
                    try (var rs = ps.executeQuery()) {
                        assertTrue(rs.next());
                        hold = rs.getString(1);
                    }
                }
                try (var ps = c.prepareStatement("INSERT INTO offer_decision_operations (environment_id, run_id, operation_id, "
                        + "operation_type, offer_id, hold_id, payload) SELECT environment_id, run_id, 'learning-pending-intent', "
                        + "'offer-selection', offer_id, hold_id, jsonb_build_object('decidedAt', CAST(? AS text)) FROM buddy_offers "
                        + "WHERE environment_id = ? AND run_id = ? AND hold_id = ?")) {
                    ps.setString(1, pendingAt);
                    ps.setString(2, BuddyJourneySeed.ENV);
                    ps.setString(3, BuddyJourneySeed.RUN);
                    ps.setString(4, hold);
                    assertEquals(1, ps.executeUpdate());
                }
                try (var ps = c.prepareStatement("UPDATE custody_holds SET state = 'selection-pending', "
                        + "operation_id = 'learning-pending-intent' WHERE environment_id = ? AND run_id = ? AND hold_id = ?")) {
                    ps.setString(1, BuddyJourneySeed.ENV);
                    ps.setString(2, BuddyJourneySeed.RUN);
                    ps.setString(3, hold);
                    assertEquals(1, ps.executeUpdate());
                }
                JsonNode row = outcomeRows.read(c, BuddyJourneySeed.ENV, BuddyJourneySeed.RUN).holds().stream()
                        .filter(h -> hold.equals(h.path("holdId").asText())).findFirst().orElseThrow();
                assertEquals(pendingAt, row.path("pendingAt").asText());
                assertFalse(row.has("selectedAt"));
            } finally {
                c.rollback();
            }
        }
    }

    /** The production adapter uses five set reads, including native plans on the actual producer rows. */
    private void assertSourceReadBounds() throws Exception {
        List<String> statements = new ArrayList<>();
        try (Connection c = dataSource.getConnection()) {
            c.setReadOnly(true);
            c.setAutoCommit(false);
            Connection counted = (Connection) Proxy.newProxyInstance(getClass().getClassLoader(),
                    new Class<?>[] {Connection.class}, (proxy, method, args) -> {
                        if (method.getName().equals("prepareStatement")) statements.add((String) args[0]);
                        try {
                            return method.invoke(c, args);
                        } catch (InvocationTargetException e) {
                            throw e.getCause();
                        }
                    });
            long started = System.nanoTime();
            LearningOutcomeRows.Rows rows = outcomeRows.read(counted, BuddyJourneySeed.ENV, BuddyJourneySeed.RUN);
            assertEquals(5, statements.size());
            assertEquals(2, rows.offers().size());
            assertEquals(2, rows.decisions().size());
            System.out.printf("learning-producer source: statements=%d offers=%d decisions=%d elapsedMs=%.3f%n",
                    statements.size(), rows.offers().size(), rows.decisions().size(), (System.nanoTime() - started) / 1_000_000.0);
            for (int i = 0; i < statements.size(); i++) {
                try (var ps = c.prepareStatement("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + statements.get(i))) {
                    ps.setString(1, BuddyJourneySeed.ENV);
                    ps.setString(2, BuddyJourneySeed.RUN);
                    try (var rs = ps.executeQuery()) {
                        assertTrue(rs.next());
                        JsonNode plan = body(rs.getString(1)).get(0);
                        System.out.printf("learning-producer plan%d: rows=%s loops=%s sharedHits=%s executionMs=%s%n",
                                i + 1, plan.path("Plan").path("Actual Rows"), plan.path("Plan").path("Actual Loops"),
                                plan.path("Plan").path("Shared Hit Blocks"), plan.path("Execution Time"));
                    }
                }
            }
            LearningOutcomeRows.Rows other = outcomeRows.read(c, BuddyJourneySeed.ENV, "another-run");
            assertEquals(LearningOutcomeRows.Rows.EMPTY, other);
            c.rollback();
        }
    }

    private static JsonNode body(String text) throws Exception {
        return BuddyJourneySupport.JSON.readTree(text);
    }

    private static JsonNode record(LearningRecordResult result, String offerId) {
        String expected = "offer:" + CanonicalJson.digest(BuddyJourneySupport.JSON.createArrayNode()
                .add(BuddyJourneySeed.RUN).add("offer").add(offerId));
        for (JsonNode record : result.value().path("records")) {
            if (expected.equals(record.path("target").path("offerRef").asText())) return record;
        }
        return fail("No record for the actual offer");
    }
}
