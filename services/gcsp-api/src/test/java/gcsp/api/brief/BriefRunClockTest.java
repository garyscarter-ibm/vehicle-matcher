package gcsp.api.brief;

import static gcsp.api.brief.Harness.obj;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClock;
import gcsp.api.persistence.TransactionRunner;
import java.sql.SQLException;
import java.time.Instant;
import java.time.InstantSource;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The common brief boundary uses one scoped domain reading, never wall time or another run's clock. */
class BriefRunClockTest {
    private static final Instant START = Instant.parse("2026-01-02T09:00:00.123456Z");
    BriefFixture f;
    Harness h;
    RunClock clock;
    Instant now;
    long version;

    @BeforeEach
    void setUp() throws SQLException {
        f = BriefFixture.create();
        h = new Harness(f);
        f.account.contract("contract-1", "Model X");
        clock = new RunClock(f.pool(), new TransactionRunner(f.pool()), null, List.of(), InstantSource.system());
        use(clock::now);
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    private void use(BriefService.ScopedClock source) throws SQLException {
        f.service = new BriefService(f.pool(), f.policy, f.account, f.offers,
                (scope, input) -> BriefPreviewPort.unconfigured(), source);
    }

    private void seed() throws SQLException {
        now = START;
        version = 1;
        f.update("INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, "
                + "fixture_version, starts_at, named_times) VALUES (?, 'run-1', ?::timestamptz, 1, 'scenario-1', "
                + "'fixture-1', ?::timestamptz, '{}'::jsonb)", BriefFixture.ENV, now.toString(), now.toString());
    }

    private void next() throws SQLException {
        now = now.plusSeconds(60);
        version++;
        f.update("UPDATE run_clocks SET clock_instant = ?::timestamptz, clock_version = ?, version = version + 1 "
                + "WHERE environment_id = ? AND run_id = 'run-1'", now.toString(), version, BriefFixture.ENV);
    }

    private void at(JsonNode value, String pointer) {
        assertEquals(now.truncatedTo(ChronoUnit.MILLIS), Instant.parse(value.at(pointer).asText()), pointer);
    }

    private void confirmed(JsonNode result) {
        at(h.current(), "/brief/confirmedAt");
        at(result, "/event/occurredAt");
    }

    @Test
    void everyCommonWriterUsesTheMatchingRunInstant() throws Exception {
        seed();
        at(h.saveOk(h.three()), "/savedAt"); // SAVE_DRAFT
        next();
        ObjectNode consent = h.at("confirm");
        consent.putObject("consent").put("search", true).put("hold", true);
        JsonNode confirmed = h.ok(f.service.confirm(f.scope, consent)); // CONFIRM
        confirmed(confirmed);
        at(confirmed, "/brief/preferences/body/confirmedAt");
        at(confirmed, "/brief/buddy/confirmedAt");
        next();
        ObjectNode preferences = h.at("preferences");
        preferences.putObject("changes").putObject("comfort").put("value", 50);
        preferences.putObject("currentCarRating").put("contractId", "contract-1").put("value", 4);
        preferences.putObject("sameAgain").put("contractId", "contract-1").put("on", false);
        h.ok(f.service.savePreferences(f.scope, preferences)); // SAVE_PREFERENCES, autosaves a confirmed brief
        at(h.current(), "/brief/confirmedAt");
        at(h.current(), "/brief/preferences/comfort/confirmedAt");
        at(h.current(), "/brief/currentCarRating/ratedAt");
        at(h.current(), "/brief/sameAgain/setAt");
        next();
        confirmed(h.ok(f.service.pauseSearch(f.scope, h.at("pause")))); // PAUSE
        at(h.current(), "/brief/buddy/pausedAt");
        next();
        confirmed(h.ok(f.service.resumeSearch(f.scope, h.at("resume")))); // RESUME
        at(h.current(), "/brief/buddy/resumedAt");
        next();
        confirmed(h.ok(f.service.disengage(f.scope, h.at("disengage")))); // DISENGAGE
        at(h.current(), "/brief/buddy/disengagedAt");
        next();
        confirmed(h.ok(f.service.engage(f.scope, h.at("engage")))); // ENGAGE
        at(h.current(), "/brief/buddy/engagedAt");
        at(h.current(), "/brief/buddy/confirmedAt");
        next();
        try (var c = f.pool().getConnection()) {
            c.createStatement().execute("SET session_replication_role = replica");
            try (var ps = c.prepareStatement("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, "
                    + "command_id, input_digest, employee_id, hold_id, decision, reason_code, versions, outcome, decided_at) "
                    + "VALUES (?, 'run-1', 'offer-d1', 'd1', 'cmd', repeat('a', 64), 'emp-1', 'hold-1', 'decline', "
                    + "'body-style', ?::jsonb, '{}'::jsonb, ?::timestamptz)")) {
                ps.setString(1, BriefFixture.ENV);
                ps.setString(2, "{\"brief\":" + h.briefVersion() + "}");
                ps.setString(3, now.toString());
                ps.executeUpdate();
            }
        }
        ObjectNode change = obj().put("commandId", "decline-change").put("expectedBriefVersion", h.briefVersion())
                .put("decisionId", "d1");
        change.putObject("change").put("path", "preferences.body.value").put("value", "suv");
        JsonNode changed = h.ok(f.service.changeAfterDecline(f.scope, change)); // DECLINE_CHANGE
        confirmed(changed);
        at(changed, "/brief/preferences/body/confirmedAt");
        at(changed, "/brief/postDeclineChange/confirmedAt");
        assertEquals("principal-1", changed.at("/brief/confirmedBy").asText());
        assertEquals(h.briefVersion() - 1, changed.at("/brief/previousBriefVersion").asLong());
    }

    @Test
    void editorUsesOneReadingForItsContextInstantAndClockVersion() throws Exception {
        AtomicInteger reads = new AtomicInteger();
        use((environment, run) -> {
            assertEquals(BriefFixture.ENV, environment);
            assertEquals("run-1", run);
            int n = reads.incrementAndGet();
            return Optional.of(new ClockReading(START.plusSeconds(n), 40 + n));
        });
        JsonNode editor = h.ok(f.service.readEditor(f.scope));
        assertEquals(1, reads.get());
        assertEquals(START.plusSeconds(1).truncatedTo(ChronoUnit.MILLIS),
                Instant.parse(editor.at("/context/knownFacts/currentContract/observedAt").asText()));
        assertEquals("41", editor.at("/versions/clock").asText());
        assertEquals(0, f.count("SELECT count(*) FROM brief_heads"));
    }

    private List<Supplier<BriefResult>> commands() {
        ObjectNode draft = h.at("draft").set("brief", h.three());
        ObjectNode preferences = h.at("preferences");
        preferences.putObject("changes").putObject("comfort").put("value", 50);
        ObjectNode change = obj().put("commandId", "decline").put("expectedBriefVersion", 0).put("decisionId", "d1");
        change.putObject("change").put("path", "preferences.body.value").put("value", "suv");
        return List.of(() -> f.service.saveDraft(f.scope, draft), () -> f.service.savePreferences(f.scope, preferences),
                () -> f.service.confirm(f.scope, h.at("confirm")), () -> f.service.changeAfterDecline(f.scope, change),
                () -> f.service.engage(f.scope, h.at("engage")), () -> f.service.disengage(f.scope, h.at("disengage")),
                () -> f.service.pauseSearch(f.scope, h.at("pause")), () -> f.service.resumeSearch(f.scope, h.at("resume")));
    }

    private void refusesWithoutWrites() throws Exception {
        List<Long> before = f.snapshot();
        for (Supplier<BriefResult> command : commands()) h.refused(command.get(), 503, "brief-unavailable");
        h.refused(f.service.readEditor(f.scope), 503, "brief-unavailable");
        assertEquals(before, f.snapshot());
    }

    @Test
    void missingFailingAndInvalidClockReadingsRefuseEveryWriterWithoutAHeadOrReceipt() throws Exception {
        refusesWithoutWrites(); // real RunClock: no row
        use((environment, run) -> { throw new IllegalStateException("clock storage unavailable"); });
        refusesWithoutWrites();
        use((environment, run) -> Optional.of(new ClockReading(null, 1)));
        refusesWithoutWrites();
        use((environment, run) -> Optional.of(new ClockReading(START, 0)));
        refusesWithoutWrites();
    }

    @Test
    void anotherRunsClockAndForeignEnvironmentCannotSupplyTheRequestedClock() throws Exception {
        f.update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, 'other-run', 'retired', now())",
                BriefFixture.ENV);
        f.update("INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, "
                + "fixture_version, starts_at, named_times) VALUES (?, 'other-run', ?::timestamptz, 99, 's', 'f', "
                + "?::timestamptz, '{}'::jsonb)", BriefFixture.ENV, START.toString(), START.toString());
        refusesWithoutWrites();
        seed();
        BriefScope foreign = new BriefScope("foreign-env", "run-1", "emp-1", "principal-1", BriefFixture.POLICY);
        List<Long> before = f.snapshot();
        ObjectNode input = h.at("foreign").set("brief", h.three());
        h.refused(f.service.saveDraft(foreign, input), 503, "brief-unavailable");
        h.refused(f.service.readEditor(foreign), 503, "brief-unavailable");
        assertEquals(before, f.snapshot());
    }

    @Test
    void aRetiredRunsClockCannotAuthorNewWritesOrAnEditorContext() throws Exception {
        seed();
        f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-1'");
        refusesWithoutWrites();
    }

    @Test
    void replayKeepsTheOriginalTimestampAndStaleVersionsDoNotWrite() throws Exception {
        seed();
        ObjectNode request = h.at("save-once").set("brief", h.three());
        JsonNode first = h.ok(f.service.saveDraft(f.scope, request));
        List<Long> after = f.snapshot();
        next();
        BriefResult replay = f.service.saveDraft(f.scope, request);
        assertTrue(((BriefResult.Ok) replay).replayed());
        assertEquals(first, h.ok(replay));
        assertEquals(after, f.snapshot());
        ObjectNode stale = request.deepCopy().put("commandId", "stale");
        h.refused(f.service.saveDraft(f.scope, stale), 409, "stale-version");
        assertEquals(after, f.snapshot());
        ObjectNode changed = request.deepCopy();
        ((ObjectNode) changed.at("/brief/preferences/body")).put("importance", 60);
        h.refused(f.service.saveDraft(f.scope, changed), 409, "command-input-changed");
        assertEquals(after, f.snapshot());
    }

    @Test
    void explicitJavaClockConstructorsKeepTheirOriginalTimeAndEditorVersionBehavior() throws Exception {
        f.service = f.newService(f.pool());
        assertEquals(BriefFixture.NOW, Instant.parse(h.saveOk(h.three()).get("savedAt").asText()));
        JsonNode editor = h.ok(f.service.readEditor(f.scope));
        assertEquals("system", editor.at("/versions/clock").asText());
        assertEquals(BriefFixture.NOW, Instant.parse(editor.at("/context/knownFacts/currentContract/observedAt").asText()));
    }
}
