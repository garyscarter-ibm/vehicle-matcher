package gcsp.api.brief;

import static gcsp.api.brief.BriefJourneySupport.BASE;
import static gcsp.api.brief.BriefJourneySupport.command;
import static gcsp.api.brief.BriefJourneySupport.count;
import static gcsp.api.brief.BriefJourneySupport.get;
import static gcsp.api.brief.BriefJourneySupport.post;
import static gcsp.api.brief.BriefJourneySupport.read;
import static gcsp.api.brief.BriefJourneySupport.tree;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.BriefAccountAdapter;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyBriefAdapter;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/**
 * FUCQ-460 phase 1: the brief over real RS256 tokens, the real ports and native PostgreSQL in the documented dev
 * composition, on the system clock. Phase 2 restarts the app on the same schema.
 */
@QuarkusTest
@TestProfile(BriefJourneyProfiles.Phase1.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class BriefJourneyPhase1HttpTest {

    private static final String PAULA = "employee-paula";
    private static final String CONTRACT = "current:employee-paula";
    private static final String POLICY = "gcsp-policy-v1";
    /** Every command this phase sent that changed state: id, path and body, for the restart replay. */
    private static final List<ObjectNode> COMMANDS = Collections.synchronizedList(new ArrayList<>());

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    BriefPolicyPort policy;

    @Inject
    BriefAccountPort account;

    @Inject
    BriefOfferPort offers;

    @Inject
    BriefPreviewPort preview;

    private String paula;
    private String alex;
    private String jordan;
    private String presenter;

    @BeforeEach
    void tokens() throws Exception {
        Assumptions.assumeTrue(BriefJourneyProfiles.URL != null && !BriefJourneyProfiles.URL.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        Assumptions.assumeTrue(persistence.active(), "persistence is not active");
        paula = BriefJourneySupport.token(signingJwk, "sub-paula", "employee");
        alex = BriefJourneySupport.token(signingJwk, "sub-alex", "employee");
        jordan = BriefJourneySupport.token(signingJwk, "sub-jordan", "employee");
        presenter = BriefJourneySupport.token(signingJwk, "sub-presenter", "presenter");
    }

    // ---- helpers ----

    private static long[] versions(String token) throws Exception {
        JsonNode initial = read(token, "/editor").get("initial");
        return new long[] {initial.get("briefVersion").longValue(), initial.get("draftVersion").longValue()};
    }

    /** Posts a command at the current versions, expects 200 and records it for the restart replay. */
    private JsonNode save(String token, String id, String path, String rest) throws Exception {
        long[] v = versions(token);
        String body = command(id, v[0], v[1], rest);
        Response r = post(token, path, body);
        r.then().statusCode(200);
        ObjectNode sent = BriefJourneySupport.JSON.createObjectNode().put("commandId", id).put("path", path).put("body", body);
        JsonNode out = tree(r);
        sent.set("value", out.get("value"));
        COMMANDS.add(sent);
        return out.get("value");
    }

    private static void record(String token, String id, String path, String body, JsonNode value) {
        COMMANDS.add(BriefJourneySupport.JSON.createObjectNode().put("commandId", id).put("path", path).put("body", body).set("value", value));
    }

    private JsonNode saveBare(String token, String id, String path) throws Exception {
        long[] v = versions(token);
        String body = "{\"commandId\":\"" + id + "\",\"expectedBriefVersion\":" + v[0] + "}";
        Response r = post(token, path, body);
        r.then().statusCode(200);
        JsonNode out = tree(r).get("value");
        record(token, id, path, body, out);
        return out;
    }

    /** All four reads and the rows agree on one saved state; returns the editor. */
    private JsonNode agree(String token, String employee) throws Exception {
        JsonNode editor = read(token, "/editor");
        JsonNode initial = editor.get("initial");
        long brief = initial.get("briefVersion").longValue();
        long draft = initial.get("draftVersion").longValue();
        JsonNode history = read(token, "/history").get("versions");
        assertEquals(brief, history.size(), "history length is the brief version");
        BriefAccountPort.AccountFacts adapter = account.facts(BriefJourneyProfiles.ENV, BriefJourneyProfiles.RUN, employee).orElseThrow();
        String facts = adapter.factsVersion();
        assertNotNull(facts);
        assertEquals(adapter.known().providerFactsVersion(), editor.get("versions").get("facts").textValue(),
                "the editor's fact source version is the adapter's");
        if (brief == 0) {
            get(token, "").then().statusCode(404);
        } else {
            JsonNode current = read(token, "").get("brief");
            assertEquals(brief, current.get("briefVersion").longValue());
            assertEquals(current, history.get((int) brief - 1), "the current brief is the newest history row");
            for (int i = 0; i < history.size(); i++) {
                assertEquals(i + 1, history.get(i).get("briefVersion").longValue());
                assertEquals(POLICY, history.get(i).get("policyVersion").textValue());
                assertEquals(facts, history.get(i).get("accountFactsVersion").textValue());
            }
        }
        if (draft == 0) {
            get(token, "/draft").then().statusCode(404);
        } else {
            JsonNode saved = read(token, "/draft");
            assertEquals(draft, saved.get("draftVersion").longValue());
            assertEquals(POLICY, saved.get("policyVersion").textValue());
            assertEquals(facts, draftFactsVersion(employee, draft));
        }
        assertEquals(draft, count("SELECT count(*) FROM brief_drafts WHERE employee_id = ?", employee));
        return editor;
    }

    private static String draftFactsVersion(String employee, long draft) throws Exception {
        try (Connection c = BriefJourneySupport.connect(); PreparedStatement ps = c.prepareStatement(
                "SELECT account_facts_version FROM brief_drafts WHERE employee_id = ? AND draft_version = ?")) {
            ps.setString(1, employee);
            ps.setLong(2, draft);
            try (java.sql.ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                return rs.getString(1);
            }
        }
    }

    /** Test-only seeding in replica mode (skips the offer, hold and stock rows these checks never read). */
    private static void seed(String sql, String... args) throws Exception {
        try (Connection c = BriefJourneySupport.connect()) {
            c.createStatement().execute("SET session_replication_role = replica");
            try (PreparedStatement ps = c.prepareStatement(sql)) {
                for (int i = 0; i < args.length; i++) ps.setString(i + 1, args[i]);
                ps.executeUpdate();
            }
        }
    }

    private static String choice(String key, String value) {
        return "\"" + key + "\":{\"value\":" + value + "}";
    }

    // ---- composition ----

    @Test
    @Order(1)
    void theRealPortsAreTheOnesInjected() {
        assertEquals(PolicyBriefAdapter.class, ClientProxy.unwrap(policy).getClass());
        assertEquals(BriefAccountAdapter.class, ClientProxy.unwrap(account).getClass());
        assertEquals(PostgresBriefOffers.class, ClientProxy.unwrap(offers).getClass());
        assertEquals(RecommendationBriefPreview.class, ClientProxy.unwrap(preview).getClass());
    }

    // ---- AC1: authorised saves, version checks and consistent saved state ----

    @Test
    @Order(2)
    void theEditorOpensWithTheFieldsTheBrowserValidatesAndPaulasRealFacts() throws Exception {
        JsonNode editor = read(paula, "/editor");
        JsonNode context = editor.get("context");
        assertTrue(context.get("contextVersion").isTextual());
        for (String key : List.of("policy", "context", "facts", "clock")) assertTrue(editor.get("versions").get(key).isTextual(), key);
        assertEquals(context.get("policyVersion").textValue(), editor.get("versions").get("policy").textValue());
        assertEquals(POLICY, context.get("policyVersion").textValue());
        JsonNode facts = context.get("knownFacts");
        assertEquals("BMW 3 Series Touring 320i", facts.get("currentContract").get("value").get("model").textValue());
        assertEquals(CONTRACT, facts.get("currentContract").get("value").get("contractId").textValue());
        assertTrue(facts.get("drivers").get("value").isArray() && facts.get("drivers").get("value").size() >= 1);
        facts.fields().forEachRemaining(e -> assertFalse(e.getValue().get("editable").booleanValue(), e.getKey()));
        assertEquals(0, editor.get("initial").get("briefVersion").intValue());
        assertEquals(0, editor.get("initial").get("draftVersion").intValue());
        assertEquals(CONTRACT, editor.get("initial").get("currentCarRating").get("contractId").textValue());
        assertTrue(editor.get("initial").get("sameAgain").get("available").booleanValue());
        agree(paula, PAULA);
    }

    @Test
    @Order(3)
    void paulaSavesPreferencesRatingSameAgainADraftAndConfirmsWithEveryReadAgreeing() throws Exception {
        // A category plus a current-car rating at the editor's versions: both versions advance by saved state.
        JsonNode first = save(paula, "bj-p1", "/preferences", "\"changes\":{" + choice("comfort", "50") + "},"
                + "\"currentCarRating\":{\"contractId\":\"" + CONTRACT + "\",\"value\":4}");
        assertEquals(0, first.get("briefVersion").intValue());
        assertEquals(1, first.get("draftVersion").intValue());
        assertEquals(1, first.get("accountPreferences").get("considered").intValue());
        assertEquals(4, first.get("currentCarRating").get("value").intValue());
        JsonNode editor = agree(paula, PAULA);
        assertEquals(4, editor.get("initial").get("currentCarRating").get("value").intValue());

        // Same again meets the Account minimum on its own, so engaging becomes possible without three categories.
        JsonNode again = save(paula, "bj-p2", "/preferences", "\"changes\":{},\"sameAgain\":{\"contractId\":\"" + CONTRACT + "\",\"on\":true}");
        assertTrue(again.get("sameAgain").get("on").booleanValue());
        editor = agree(paula, PAULA);
        assertTrue(editor.get("initial").get("buddy").get("canEngage").booleanValue());
        assertEquals(2, editor.get("initial").get("draftVersion").intValue());

        // Turning it off while adding categories counts the categories again.
        JsonNode three = save(paula, "bj-p3", "/preferences", "\"changes\":{" + choice("body", "[\"estate\"]") + ","
                + choice("sportiness", "50") + "},\"sameAgain\":{\"contractId\":\"" + CONTRACT + "\",\"on\":false}");
        assertEquals(3, three.get("accountPreferences").get("considered").intValue());
        editor = agree(paula, PAULA);
        assertFalse(editor.get("initial").get("sameAgain").get("on").booleanValue());

        // A whole-brief draft from the editor's own content, with a fourth category.
        ObjectNode brief = ((ObjectNode) editor.get("initial").get("brief")).deepCopy();
        ((ObjectNode) brief.get("preferences")).putObject("economy").put("value", 50).put("importance", 50)
                .put("valueState", "draft").put("importanceState", "draft").put("source", "employee");
        JsonNode draft = save(paula, "bj-d1", "/draft", "\"brief\":" + brief);
        assertEquals(4, draft.get("draftVersion").intValue());
        agree(paula, PAULA);

        // Confirm with consent: the minimum is met, so the search is on and brief version 1 exists.
        JsonNode confirmed = save(paula, "bj-c1", "/confirm", "\"consent\":{\"search\":true,\"hold\":true}");
        assertEquals(1, confirmed.get("brief").get("briefVersion").intValue());
        assertTrue(confirmed.get("activity").get("canSearch").booleanValue());
        editor = agree(paula, PAULA);
        assertEquals("engaged", editor.get("initial").get("buddy").get("state").textValue());
        assertEquals("approved-brief", editor.get("provenance").get("initial").textValue());
    }

    @Test
    @Order(4)
    void pauseAndResumeKeepEveryReadInStepAndTheLegacyAliasesDoTheSame() throws Exception {
        long before = versions(paula)[0];
        save(paula, "bj-ps", "/pause-search", "");
        assertEquals(before + 1, versions(paula)[0]);
        JsonNode editor = agree(paula, PAULA);
        assertEquals("disengaged", editor.get("initial").get("buddy").get("state").textValue());
        assertEquals("paused", editor.get("initial").get("buddy").get("reason").textValue());
        assertFalse(read(paula, "").get("activity").get("canSearch").booleanValue());

        save(paula, "bj-rs", "/resume-search", "");
        editor = agree(paula, PAULA);
        assertEquals("engaged", editor.get("initial").get("buddy").get("state").textValue());
        assertTrue(read(paula, "").get("activity").get("canSearch").booleanValue());

        saveBare(paula, "bj-lp", "/pause");
        assertEquals("disengaged", agree(paula, PAULA).get("initial").get("buddy").get("state").textValue());
        saveBare(paula, "bj-lr", "/resume");
        assertEquals("engaged", agree(paula, PAULA).get("initial").get("buddy").get("state").textValue());
    }

    @Test
    @Order(5)
    void droppingBelowTheMinimumWhileEngagedDisengagesAndLaterEvaluationSeesIt() throws Exception {
        JsonNode out = save(paula, "bj-ml", "/preferences", "\"changes\":{\"comfort\":null,\"economy\":null}");
        assertEquals("minimum-lost", out.get("buddyTransition").textValue());
        assertEquals("disengaged", out.get("buddy").get("state").textValue());
        JsonNode editor = agree(paula, PAULA);
        JsonNode buddy = editor.get("initial").get("buddy");
        assertEquals("minimum-lost", buddy.get("reason").textValue());
        assertFalse(buddy.get("canEngage").booleanValue());
        assertEquals(2, buddy.get("considered").intValue());
        assertFalse(read(paula, "").get("activity").get("canSearch").booleanValue());
        assertFalse(read(paula, "").get("activity").get("canHold").booleanValue());
        long[] v = versions(paula);
        post(paula, "/engage", command("bj-e-low", v[0], v[1], "")).then().statusCode(400)
                .body("code", org.hamcrest.Matchers.equalTo("engagement-minimum")).body("remaining", org.hamcrest.Matchers.equalTo(1));
    }

    @Test
    @Order(6)
    void feedbackAfterADeclineRecordsOneChangeWithItsAudit() throws Exception {
        long brief = versions(paula)[0];
        String decision = "briefj-decline-" + Long.toHexString(System.nanoTime());
        // This row stands in for a real local decline: under the documented config decline reasons are absent from the policy seed (FUCQ-510).
        seed("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, command_id, input_digest, employee_id, "
                + "hold_id, decision, reason_code, versions, outcome, decided_at) VALUES ('" + BriefJourneyProfiles.ENV + "', 'run-1', "
                + "'offer-" + decision + "', ?, 'cmd', repeat('b', 64), '" + PAULA + "', 'hold-x', 'decline', 'body-style', "
                + "'{\"brief\":" + brief + ",\"policy\":\"" + POLICY + "\"}'::jsonb, '{}'::jsonb, now())", decision);
        long[] v = versions(paula);
        String body = "{\"commandId\":\"bj-dc\",\"expectedBriefVersion\":" + v[0] + ",\"decisionId\":\"" + decision + "\","
                + "\"change\":{\"path\":\"preferences.body.value\",\"value\":\"suv\"}}";
        Response r = post(paula, "/change-after-decline", body);
        r.then().statusCode(200);
        JsonNode out = tree(r).get("value");
        record(paula, "bj-dc", "/change-after-decline", body, out);
        assertEquals(brief + 1, out.get("brief").get("briefVersion").longValue());
        assertEquals(decision, out.get("brief").get("postDeclineChange").get("decisionId").textValue());
        agree(paula, PAULA);
        JsonNode last = read(paula, "/history").get("versions").get((int) brief);
        assertEquals(decision, last.get("postDeclineChange").get("decisionId").textValue());
        assertEquals("suv", last.get("preferences").get("body").get("value").textValue());
        assertEquals(1, count("SELECT count(*) FROM briefs WHERE employee_id = ? AND operation = 'changed-after-decline'", PAULA));
    }

    @Test
    @Order(7)
    void anAcceptedOfferMakesTheBriefReadOnlyAndTheEditorSaysSo() throws Exception {
        save(alex, "bj-a1", "/preferences", "\"changes\":{" + choice("body", "[\"estate\"]") + "," + choice("sportiness", "50") + ","
                + choice("comfort", "50") + "}");
        save(alex, "bj-a2", "/confirm", "\"consent\":{\"search\":true,\"hold\":true}");
        agree(alex, "employee-alex");
        // A direct row stands in for an accepted offer: the offer decision flow belongs to FUCQ-466.
        seed("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, employee_id, order_uuid, state, "
                + "brief_version, policy_version, expires_at) VALUES ('" + BriefJourneyProfiles.ENV + "', 'run-1', ?, 'hold-alex', "
                + "'quote-alex', 'employee-alex', 'order-alex', 'accepted', 1, '" + POLICY + "', now() + interval '1 day')",
                "offer-briefj-" + Long.toHexString(System.nanoTime()));
        long[] v = versions(alex);
        post(alex, "/preferences", command("bj-a3", v[0], v[1], "\"changes\":{" + choice("economy", "50") + "}")).then().statusCode(409)
                .body("code", org.hamcrest.Matchers.equalTo("brief-read-only"));
        JsonNode editor = read(alex, "/editor");
        assertEquals("accepted", editor.get("selection").get("state").textValue());
        assertEquals(1, editor.get("selection").get("briefVersion").intValue());
        assertEquals(v[1], versions(alex)[1], "the refused write saved nothing");
        assertEquals(1, read(alex, "").get("activity").get("existingOffers").size());
    }

    // ---- AC2: refusals ----

    private long[] rows() throws Exception {
        return new long[] {count("SELECT count(*) FROM briefs"), count("SELECT count(*) FROM brief_drafts"),
            count("SELECT count(*) FROM command_receipts WHERE command_type LIKE 'brief.%'"),
            count("SELECT count(*) FROM outbox_events WHERE event_type LIKE 'brief-%'")};
    }

    @Test
    @Order(8)
    void aStaleWriterIsRefusedAndNothingIsWritten() throws Exception {
        long[] v = versions(paula);
        JsonNode historyBefore = read(paula, "/history");
        JsonNode draftBefore = read(paula, "/draft");
        long[] counts = rows();
        for (String stale : new String[] {command("bj-s1", v[0] - 1, v[1], "\"changes\":{" + choice("size", "100") + "}"),
            command("bj-s2", v[0], v[1] - 1, "\"changes\":{" + choice("size", "100") + "}")}) {
            Response r = post(paula, "/preferences", stale);
            r.then().statusCode(409).body("status", org.hamcrest.Matchers.equalTo("stale-version"))
                    .body("code", org.hamcrest.Matchers.equalTo("stale-version")).body("action", org.hamcrest.Matchers.equalTo("refresh"));
        }
        assertEquals(historyBefore, read(paula, "/history"));
        assertEquals(draftBefore, read(paula, "/draft"));
        assertEquals(java.util.Arrays.toString(counts), java.util.Arrays.toString(rows()));
        assertEquals(java.util.Arrays.toString(v), java.util.Arrays.toString(versions(paula)));
    }

    @Test
    @Order(9)
    void twoWritersAtTheSameVersionsHaveExactlyOneWinner() throws Exception {
        long[] v = versions(paula);
        String a = command("bj-w1", v[0], v[1], "\"changes\":{" + choice("size", "100") + "}");
        String b = command("bj-w2", v[0], v[1], "\"changes\":{" + choice("economy", "100") + "}");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Response>> out = new ArrayList<>();
            for (String body : List.of(a, b)) {
                out.add(pool.submit(() -> {
                    go.await();
                    return post(paula, "/preferences", body);
                }));
            }
            go.countDown();
            List<Integer> codes = new ArrayList<>();
            for (int i = 0; i < out.size(); i++) {
                Response r = out.get(i).get();
                codes.add(r.statusCode());
                if (r.statusCode() == 200) record(paula, i == 0 ? "bj-w1" : "bj-w2", "/preferences", i == 0 ? a : b, tree(r).get("value"));
                else assertEquals("stale-version", tree(r).get("code").textValue());
            }
            Collections.sort(codes);
            assertEquals(List.of(200, 409), codes);
        } finally {
            pool.shutdownNow();
        }
        long[] after = versions(paula);
        assertEquals(v[1] + 1, after[1], "exactly one draft was saved");
        agree(paula, PAULA);
    }

    @Test
    @Order(10)
    void invalidInputIsRefusedWithReasonsAndReplaysAreExact() throws Exception {
        long[] v = versions(paula);
        long[] counts = rows();
        String unknown = command("bj-i1", v[0], v[1], "\"changes\":{\"nope\":{\"value\":1}}");
        String wrongType = command("bj-i2", v[0], v[1], "\"changes\":{" + choice("size", "\"big\"") + "}");
        String versionText = "{\"commandId\":\"bj-i3\",\"expectedBriefVersion\":\"x\",\"expectedDraftVersion\":" + v[1] + ",\"changes\":{}}";
        String extra = command("bj-i4", v[0], v[1], "\"changes\":{},\"employeeId\":\"employee-alex\"");
        for (String bad : new String[] {unknown, wrongType, versionText, extra}) {
            Response r = post(paula, "/preferences", bad);
            r.then().statusCode(400);
            JsonNode body = tree(r);
            assertEquals("invalid", body.get("status").textValue(), body.toString());
            assertTrue(body.get("reasons").isArray() && body.get("reasons").size() >= 1, body.toString());
        }
        assertEquals(java.util.Arrays.toString(counts), java.util.Arrays.toString(rows()), "refusals write nothing");

        // The same command id with the same body replays the stored value; a changed body is refused.
        String body = command("bj-r1", v[0], v[1], "\"changes\":{" + choice("size", "0") + "}");
        Response first = post(paula, "/preferences", body);
        first.then().statusCode(200);
        JsonNode original = tree(first);
        assertFalse(original.has("replayed"));
        record(paula, "bj-r1", "/preferences", body, original.get("value"));
        JsonNode replay = tree(post(paula, "/preferences", body));
        assertTrue(replay.get("replayed").booleanValue());
        assertEquals(original.get("value"), replay.get("value"));
        post(paula, "/preferences", body.replace("\"value\":0", "\"value\":50")).then().statusCode(409)
                .body("code", org.hamcrest.Matchers.equalTo("command-input-changed"));
        assertEquals(counts[1] + 1, rows()[1], "only the first send saved a draft");
        agree(paula, PAULA);
    }

    @Test
    @Order(11)
    void unauthorisedCallersAreRefusedBeforeAnythingIsReadOrWritten() throws Exception {
        long[] counts = rows();
        long[] v = versions(paula);
        String body = command("bj-u1", v[0], v[1], "\"changes\":{" + choice("size", "100") + "}");
        for (String path : new String[] {"", "/history", "/draft", "/editor"}) {
            get(null, path).then().statusCode(401);
            get(presenter, path).then().statusCode(403);
            BriefJourneySupport.as(paula).queryParam("employeeId", "employee-alex").get(BASE + path).then().statusCode(400)
                    .body("code", org.hamcrest.Matchers.equalTo("unsupported-query"));
        }
        post(null, "/preferences", body).then().statusCode(401);
        post(presenter, "/preferences", body).then().statusCode(403);
        BriefJourneySupport.as(paula).contentType("application/json").queryParam("employeeId", "employee-alex").body(body)
                .post(BASE + "/preferences").then().statusCode(400).body("code", org.hamcrest.Matchers.equalTo("unsupported-query"));
        assertEquals(java.util.Arrays.toString(counts), java.util.Arrays.toString(rows()));
    }

    @Test
    @Order(12)
    void jordanReadsAndWritesOnlyJordansBrief() throws Exception {
        long[] paulaBefore = versions(paula);
        JsonNode paulaHistory = read(paula, "/history");
        assertEquals(0, versions(jordan)[0]);
        JsonNode jordanEditor = read(jordan, "/editor");
        assertTrue(jordanEditor.get("context").get("knownFacts").get("currentContract").get("value").isNull(), "Jordan has no contract");
        // Without a contract a rating has no car to attach to.
        Response noCar = post(jordan, "/preferences", command("bj-j0", 0, 0, "\"changes\":{},\"currentCarRating\":{\"contractId\":\""
                + CONTRACT + "\",\"value\":3}"));
        noCar.then().statusCode(409).body("code", org.hamcrest.Matchers.equalTo("no-current-car"));
        JsonNode saved = save(jordan, "bj-j1", "/preferences", "\"changes\":{" + choice("comfort", "50") + "}");
        assertEquals(1, saved.get("draftVersion").intValue());
        assertEquals(1, versions(jordan)[1]);
        assertEquals(java.util.Arrays.toString(paulaBefore), java.util.Arrays.toString(versions(paula)));
        assertEquals(paulaHistory, read(paula, "/history"));
        assertEquals(0, count("SELECT count(*) FROM brief_drafts WHERE employee_id = ? AND saved_by <> 'sub-jordan'", "employee-jordan"));
        assertEquals(0, count("SELECT count(*) FROM brief_drafts WHERE employee_id = ? AND saved_by = 'sub-jordan'", PAULA));
        agree(jordan, "employee-jordan");
    }

    @Test
    @Order(13)
    void recordsWhatTheRestartMustKeep() throws Exception {
        JsonNode editor = agree(paula, PAULA);
        ObjectNode facts = BriefJourneySupport.JSON.createObjectNode();
        facts.set("current", read(paula, ""));
        facts.set("history", read(paula, "/history"));
        facts.set("draft", read(paula, "/draft"));
        facts.set("initial", editor.get("initial"));
        ObjectNode stable = ((ObjectNode) editor.get("versions")).deepCopy();
        stable.remove("clock");
        facts.set("versions", stable);
        facts.set("contextVersion", editor.get("context").get("contextVersion"));
        ObjectNode counts = facts.putObject("counts");
        long[] rows = rows();
        counts.put("briefs", rows[0]).put("brief_drafts", rows[1]).put("command_receipts", rows[2]).put("outbox_events", rows[3]);
        ArrayNode commands = facts.putArray("commands");
        COMMANDS.forEach(commands::add);
        assertTrue(commands.size() >= 12, "the journey sent many commands");
        System.setProperty(BriefJourneyProfiles.PHASE1, facts.toString());
        assertInstanceOf(ArrayNode.class, facts.get("commands"));
    }
}
