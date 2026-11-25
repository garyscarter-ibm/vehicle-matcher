package gcsp.api.brief;

import static gcsp.api.brief.BriefJourneySupport.JSON;
import static gcsp.api.brief.BriefJourneySupport.command;
import static gcsp.api.brief.BriefJourneySupport.count;
import static gcsp.api.brief.BriefJourneySupport.post;
import static gcsp.api.brief.BriefJourneySupport.read;
import static gcsp.api.brief.BriefJourneySupport.tree;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Persistence;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** FUCQ-460 phase 2: the app restarted on phase 1's schema keeps the accepted brief state, versions and audit. */
@QuarkusTest
@TestProfile(BriefJourneyProfiles.Phase2.class)
class BriefJourneyPhase2HttpTest {

    private static final String PAULA = "employee-paula";
    private static String ownedSchema;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    BriefOfferPort offers;

    @AfterAll
    static void drop() throws Exception {
        BriefJourneySupport.dropSchema(ownedSchema);
    }

    private static long[] rows() throws Exception {
        return new long[] {count("SELECT count(*) FROM briefs"), count("SELECT count(*) FROM brief_drafts"),
            count("SELECT count(*) FROM command_receipts WHERE command_type LIKE 'brief.%'"),
            count("SELECT count(*) FROM outbox_events WHERE event_type LIKE 'brief-%'")};
    }

    @Test
    void aRestartedAppKeepsTheAcceptedStateTheVersionsAndTheAudit() throws Exception {
        Assumptions.assumeTrue(BriefJourneyProfiles.URL != null && !BriefJourneyProfiles.URL.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        Assumptions.assumeTrue(persistence.active(), "persistence is not active");
        ownedSchema = schema;
        String recorded = System.getProperty(BriefJourneyProfiles.PHASE1);
        assertNotNull(recorded, "Phase 1 must run first in the same JVM (BriefJourneyPhase1HttpTest)");
        assertEquals(BriefJourneyProfiles.SCHEMA, schema);
        JsonNode phase1 = JSON.readTree(recorded);
        String paula = BriefJourneySupport.token(signingJwk, "sub-paula", "employee");
        String alex = BriefJourneySupport.token(signingJwk, "sub-alex", "employee");

        // The real offer port is still the one in use after the restart.
        assertEquals(PostgresBriefOffers.class, ClientProxy.unwrap(offers).getClass());

        // Startup and demo preparation did not reseed or overwrite any brief row.
        long[] rows = rows();
        JsonNode counts = phase1.get("counts");
        for (long n : rows) assertTrue(n > 0, "every audit table holds phase-1 rows");
        assertEquals(counts.get("briefs").longValue(), rows[0]);
        assertEquals(counts.get("brief_drafts").longValue(), rows[1]);
        assertEquals(counts.get("command_receipts").longValue(), rows[2]);
        assertEquals(counts.get("outbox_events").longValue(), rows[3]);

        // The reads equal phase 1 exactly, including the policy and account facts versions on every history row.
        JsonNode currentRead = read(paula, "");
        assertEquals(phase1.get("current"), currentRead);
        JsonNode history = read(paula, "/history");
        assertEquals(phase1.get("history"), history);
        assertEquals(phase1.get("draft"), read(paula, "/draft"));
        JsonNode versions = history.get("versions");
        JsonNode current = currentRead.get("brief");
        assertEquals(versions.get(versions.size() - 1), current);
        for (int i = 0; i < versions.size(); i++) {
            JsonNode row = versions.get(i);
            assertTrue(row.has("previousBriefVersion"));
            if (i == 0) assertTrue(row.get("previousBriefVersion").isNull());
            else assertEquals(i, row.get("previousBriefVersion").longValue());
            assertEquals("gcsp-policy-v1", row.get("policyVersion").textValue());
            assertTrue(row.get("accountFactsVersion").isTextual());
        }
        JsonNode editor = read(paula, "/editor");
        assertEquals(phase1.get("initial"), editor.get("initial"));
        ObjectNode stable = ((ObjectNode) editor.get("versions")).deepCopy();
        stable.remove("clock");
        assertEquals(phase1.get("versions"), stable);
        assertEquals(phase1.get("contextVersion"), editor.get("context").get("contextVersion"));
        assertEquals(history.get("versions").size(), editor.get("initial").get("briefVersion").intValue());

        // An accepted offer still makes another employee's brief read-only after the restart.
        assertEquals("accepted", read(alex, "/editor").get("selection").get("state").textValue());
        long[] av = {read(alex, "/editor").get("initial").get("briefVersion").longValue(),
            read(alex, "/editor").get("initial").get("draftVersion").longValue()};
        post(alex, "/preferences", command("bj2-alex", av[0], av[1], "\"changes\":{\"size\":{\"value\":50}}")).then().statusCode(409)
                .body("code", org.hamcrest.Matchers.equalTo("brief-read-only"));

        // A phase-1 command replays with its original value and writes nothing.
        JsonNode replayable = null;
        for (JsonNode c : phase1.get("commands")) if ("bj-p1".equals(c.get("commandId").textValue())) replayable = c;
        assertNotNull(replayable, "phase 1 recorded bj-p1");
        Response replay = post(paula, replayable.get("path").textValue(), replayable.get("body").textValue());
        replay.then().statusCode(200);
        assertTrue(tree(replay).get("replayed").booleanValue());
        assertEquals(replayable.get("value"), tree(replay).get("value"));
        // A changed body under the same id is still refused.
        post(paula, replayable.get("path").textValue(), replayable.get("body").textValue().replace("\"value\":4", "\"value\":5"))
                .then().statusCode(409).body("code", org.hamcrest.Matchers.equalTo("command-input-changed"));
        assertEquals(java.util.Arrays.toString(rows), java.util.Arrays.toString(rows()), "the replay wrote nothing");

        // A stale write is still refused.
        long brief = editor.get("initial").get("briefVersion").longValue();
        long draft = editor.get("initial").get("draftVersion").longValue();
        post(paula, "/preferences", command("bj2-stale", brief - 1, draft - 1, "\"changes\":{\"size\":{\"value\":0}}")).then().statusCode(409)
                .body("code", org.hamcrest.Matchers.equalTo("stale-version")).body("action", org.hamcrest.Matchers.equalTo("refresh"));
        assertEquals(java.util.Arrays.toString(rows), java.util.Arrays.toString(rows()));

        // One new save continues from the restored versions, and the reads agree again.
        Response next = post(paula, "/preferences", command("bj2-next", brief, draft, "\"changes\":{\"size\":{\"value\":100}}"));
        next.then().statusCode(200);
        JsonNode saved = tree(next).get("value");
        assertEquals(draft + 1, saved.get("draftVersion").longValue());
        assertEquals(brief, saved.get("briefVersion").longValue());
        JsonNode after = read(paula, "/editor").get("initial");
        assertEquals(draft + 1, after.get("draftVersion").longValue());
        assertEquals(draft + 1, read(paula, "/draft").get("draftVersion").longValue());
        assertEquals(draft + 1, count("SELECT count(*) FROM brief_drafts WHERE employee_id = ?", PAULA));
        assertEquals(rows[1] + 1, rows()[1]);
    }
}
