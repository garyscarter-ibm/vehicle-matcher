package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySeed.BRUNO;
import static gcsp.api.allocation.BuddyJourneySeed.RUN;
import static gcsp.api.allocation.BuddyJourneySupport.API;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.allocation.BuddyJourneySupport.post;
import static gcsp.api.offers.OfferDecisionJourneySupport.body;
import static gcsp.api.offers.OfferDecisionJourneySupport.decide;
import static gcsp.api.offers.OfferDecisionJourneySupport.decline;
import static gcsp.api.offers.OfferDecisionJourneySupport.path;
import static gcsp.api.offers.OfferDecisionJourneySupport.view;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** FUCQ-510: after a presenter reset the new run re-adopts the journey set, so decline works there (not 503). */
@QuarkusTest
@TestProfile(OfferJourneyProfiles.ResetDecline.class)
class OfferResetDeclineHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    /** The Buddy seed's run-scoped tables, in foreign-key order. */
    private static final List<String> SEEDED = List.of("stock_cars", "employees", "entitlement_slots",
            "employee_account_records", "brief_heads", "briefs");

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @BeforeEach
    void useTheRunClockForDocuments() {
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
    }

    @Test
    void declineSucceedsOnTheRunAPresenterResetStarts() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String bruno = s.token("sub-bruno", "employee");

        JsonNode catalogue = body(get(presenter, API + "/presenter/scenarios").then().statusCode(200).extract().response());
        JsonNode mechanics = null;
        for (JsonNode entry : catalogue.get("value").get("scenarios")) {
            if ("gcsp-clock-scenario-v1".equals(entry.path("scenarioId").asText())) mechanics = entry;
        }
        assertNotNull(mechanics, catalogue.toString());
        ObjectNode reset = JSON.createObjectNode().put("commandId", "fucq510-reset").put("expectedRunId", RUN)
                .put("scenarioVersion", mechanics.get("scenarioVersion").asText())
                .put("fixtureVersion", mechanics.get("fixtureVersion").asText())
                .put("policyVersion", mechanics.get("policyVersion").asText());
        JsonNode done = body(post(presenter, API + "/presenter/clock/reset", reset.toString()).then().statusCode(200)
                .extract().response()).get("value");
        String next = done.get("activatedRunId").asText();
        assertNotEquals(RUN, next);

        copyBuddySeed(next);
        String offer = OfferDecisionJourneySupport.allocate(s, presenter, BRUNO);
        assertNotNull(offer, "Bruno has an offer on the new run");
        JsonNode reasons = body(get(bruno, path(offer) + "/decision-reasons").then().statusCode(200).extract().response())
                .get("value");
        String reason = reasons.get("reasons").get(0).get("code").asText();
        JsonNode declined = decide(bruno, offer, decline("fucq510-decline", view(bruno, offer), reason), 200).get("value");
        assertEquals("declined", declined.get("state").asText());
        assertEquals(1, s.count("SELECT count(*) FROM offer_decisions WHERE run_id = ? AND offer_id = ? "
                + "AND decision = 'decline' AND reason_code = ?", next, offer, reason));
    }

    /** The reset prepared only the demo file's people, so the Buddy people (not those) are copied onto the new run. */
    private void copyBuddySeed(String next) throws Exception {
        try (Connection c = dataSource.getConnection()) {
            List<String> prepared = new ArrayList<>();
            try (PreparedStatement ps = c.prepareStatement("SELECT employee_id FROM employees WHERE run_id = ?")) {
                ps.setString(1, next);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) prepared.add(rs.getString(1));
                }
            }
            for (String table : SEEDED) {
                String people = "stock_cars".equals(table) ? "" : " AND NOT (x.employee_id = ANY (?))";
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO " + table + " SELECT (jsonb_populate_record("
                        + "NULL::" + table + ", to_jsonb(x) || jsonb_build_object('run_id', ?::text))).* FROM " + table
                        + " x WHERE x.run_id = ?" + people)) {
                    ps.setString(1, next);
                    ps.setString(2, RUN);
                    if (!people.isEmpty()) ps.setArray(3, c.createArrayOf("text", prepared.toArray()));
                    ps.executeUpdate();
                }
            }
        }
    }
}
