package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.*;

import gcsp.api.clock.ClockResult;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Native PostgreSQL authority; no derived stock fixture substitutes for runtime generation. */
class GeneratedStockPreparationTest {
    private static final Path ROOT = Path.of("../..").toAbsolutePath().normalize();
    private SupplyFixture f;

    @BeforeEach
    void setUp() throws Exception { f = SupplyFixture.create(); }

    @AfterEach
    void clean() throws Exception { if (f != null) f.close(); }

    private GeneratedStockPreparation preparation(boolean sourcePresent) throws Exception {
        Path evidence = ROOT.resolve("server/data/gcsp/vehicle-evidence");
        var policy = new PolicyService(new RetainedFilePolicySource(ROOT.resolve("server/gcsp/policy/seed-v1.json"), List.of()));
        return new GeneratedStockPreparation(f.pool(), SupplyFixture.ENV, new GeneratedStockInputs(
                evidence.resolve(sourcePresent ? "demo-fleet.v1" : "absent"), evidence, ROOT, policy));
    }

    private GeneratedSupplyProvider provider(boolean sourcePresent, ConfirmedSupplyLookup lookup) throws Exception {
        var policy = new PolicyService(new RetainedFilePolicySource(ROOT.resolve("server/gcsp/policy/seed-v1.json"), List.of()));
        return new GeneratedSupplyProvider(preparation(sourcePresent), new DemoSupplyProvider(policy, lookup));
    }

    private static PullRequest request(Instant clock) {
        return new PullRequest("run-1", clock, "tick-1", 4, 0, "gcsp-policy-v1", List.of(), List.of());
    }

    @Test
    void completeGenerationCommitsOnceWithoutReleasingAndReplaysWithoutTheSource() throws Exception {
        long started = System.nanoTime();
        ClockResult.Ok first = assertInstanceOf(ClockResult.Ok.class,
                preparation(true).prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0, null, null));
        long elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
        assertTrue(f.cars("unreleased") > 0);
        assertEquals(0, f.cars("released"));
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(0, f.count("SELECT count(*) FROM buddy_offers"));
        long revision = f.revision();
        long rows = f.cars("unreleased");
        ClockResult.Ok replay = assertInstanceOf(ClockResult.Ok.class,
                preparation(false).prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0, null, null));
        assertEquals(first.value().path("report"), replay.value().path("report"));
        assertFalse(replay.value().path("generated").asBoolean(true));
        assertEquals(rows, f.cars("unreleased"));
        var measured = SupplyFixture.JSON.createObjectNode().put("generationMillis", elapsed)
                .put("rows", rows).put("generatedRowBytes", first.value().path("rowBytes").asLong())
                .put("storedAttributeBytes", f.count("SELECT sum(octet_length(attributes::text)) FROM stock_cars"));
        measured.set("inventoryPlan", SupplyFixture.JSON.readTree(f.text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "
                + "SELECT attributes->'generatedIdentity' FROM stock_cars WHERE environment_id = ? "
                + "AND attributes->'generatedIdentity' IS NOT NULL", SupplyFixture.ENV)));
        measured.set("pullPlan", SupplyFixture.JSON.readTree(f.text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "
                + "SELECT order_uuid, configuration_id, attributes::text FROM stock_cars WHERE environment_id = ? "
                + "AND run_id = ? AND attributes->'generatedIdentity' IS NOT NULL", SupplyFixture.ENV, "run-1")));
        System.out.println("F538_DATA_EVIDENCE " + measured);
        assertEquals(revision, f.revision());
        ClockResult.Failure changed = assertInstanceOf(ClockResult.Failure.class,
                preparation(true).prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0.plus(Duration.ofDays(1)), null, null));
        assertEquals(ClockResult.Status.CONFLICT, changed.status());
        assertEquals("command-input-changed", changed.code());
        assertEquals(rows, f.cars("unreleased"));
    }

    @Test
    void anInsertFailureRollsBackTheWholeGeneratedStockAndReceipt() throws Exception {
        f.update("CREATE FUNCTION refuse_generation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                + "IF (SELECT count(*) FROM stock_cars) > 0 THEN RAISE EXCEPTION 'forced test write failure'; END IF; RETURN NEW; END $$");
        f.update("CREATE TRIGGER refuse_generation BEFORE INSERT ON stock_cars FOR EACH ROW EXECUTE FUNCTION refuse_generation()");
        assertFalse(preparation(true).prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0, null, null).ok());
        assertEquals(0, f.count("SELECT count(*) FROM stock_cars"));
        assertEquals(0, f.count("SELECT count(*) FROM command_receipts WHERE command_type = 'stock.generate'"));
        assertEquals(0, f.revision());
    }

    @Test
    void competingInstancesCommitExactlyOneCompleteGeneration() throws Exception {
        var a = preparation(true);
        var b = preparation(true);
        CountDownLatch start = new CountDownLatch(1);
        try (var threads = Executors.newFixedThreadPool(2)) {
            var first = threads.submit(() -> { start.await(); return a.prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0, null, null); });
            var second = threads.submit(() -> { start.await(); return b.prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0, null, null); });
            start.countDown();
            ClockResult.Ok one = assertInstanceOf(ClockResult.Ok.class, first.get(30, TimeUnit.SECONDS));
            ClockResult.Ok two = assertInstanceOf(ClockResult.Ok.class, second.get(30, TimeUnit.SECONDS));
            assertEquals(CanonicalJson.canonical(one.value().path("report")), CanonicalJson.canonical(two.value().path("report")));
            assertNotEquals(one.value().path("generated").asBoolean(), two.value().path("generated").asBoolean());
            assertEquals(one.value().path("rowCount").asLong(), f.cars("unreleased"));
            assertEquals(1, f.count("SELECT count(*) FROM command_receipts WHERE command_type = 'stock.generate'"));
            assertEquals(1, f.revision());
            assertEquals(f.cars("unreleased"), f.count("SELECT count(DISTINCT order_uuid) FROM stock_cars"));
        }
    }

    @Test
    void changedInputRacingTheSameCommandConflictsWithoutASecondGeneration() throws Exception {
        var a = preparation(true);
        var b = preparation(true);
        CountDownLatch start = new CountDownLatch(1);
        try (var threads = Executors.newFixedThreadPool(2)) {
            var first = threads.submit(() -> { start.await(); return a.prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0, null, null); });
            var second = threads.submit(() -> { start.await(); return b.prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0.plusSeconds(60), null, null); });
            start.countDown();
            List<ClockResult> result = List.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS));
            assertEquals(1, result.stream().filter(ClockResult::ok).count());
            ClockResult.Failure conflict = assertInstanceOf(ClockResult.Failure.class, result.stream().filter(r -> !r.ok()).findFirst().orElseThrow());
            assertEquals("command-input-changed", conflict.code());
            assertEquals(1, f.count("SELECT count(*) FROM command_receipts WHERE command_type = 'stock.generate'"));
            assertEquals(1, f.revision());
        }
    }

    @Test
    void unavailableSourceNeverFallsBackAndRetiredRunsNeverReplay() throws Exception {
        assertInstanceOf(ProviderResponse.Unavailable.class, provider(false, (run, ids) -> Map.of()).pull(request(SupplyFixture.T0)));
        assertEquals(0, f.cars("unreleased"));
        assertEquals(0, f.revision());
        assertTrue(preparation(true).prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0, null, null).ok());
        long count = f.cars("unreleased");
        f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-1'");
        assertEquals(ClockResult.Status.STALE_RUN, preparation(false).prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0, null, null).status());
        assertInstanceOf(ProviderResponse.StaleRun.class, provider(false, (run, ids) -> { throw new AssertionError("stale run reached confirmed lookup"); }).pull(request(SupplyFixture.T0)));
        assertEquals(count, f.cars("unreleased"));
    }

    @Test
    void confirmedProductionSupplyWinsWithoutNeedingTheGeneratedSource() throws Exception {
        var confirmed = new ConfirmedSupplyLookup.Confirmed("3 Series Saloon", "320i", 2);
        var provider = provider(false, (run, ids) -> Map.of("supply-1", confirmed));
        var req = new PullRequest("run-1", SupplyFixture.T0, "tick", 2, 0, "gcsp-policy-v1", List.of(),
                List.of(new PullRequest.QueuedSupply("supply-1", SupplyFixture.T0.minusSeconds(60), SupplyFixture.T0.minusSeconds(30), "source-v1", "gcsp-policy-v1")));
        var response = assertInstanceOf(ProviderResponse.Ok.class, provider.pull(req));
        assertEquals("supply-1", response.value().path("tranche").path("supplyId").asText());
        assertEquals(2, response.value().path("stock").size());
        assertEquals(0, f.cars("unreleased"));
        assertEquals(0, f.revision());
    }

    @Test
    void expiredOmissionsAreRecordedAndReconstructedByANewProvider() throws Exception {
        assertTrue(preparation(true).prepare(f.ctx(), "gcsp-policy-v1", SupplyFixture.T0, null, null).ok());
        var provider = provider(false, (run, ids) -> Map.of());
        var expiredRequest = request(Instant.parse("2028-01-01T00:00:00Z"));
        var response = assertInstanceOf(ProviderResponse.Ok.class, provider.pull(expiredRequest));
        assertEquals(0, response.value().path("stock").size());
        assertEquals(f.cars("unreleased"), provider.expired("run-1").size());
        var restarted = provider(false, (run, ids) -> Map.of());
        assertTrue(restarted.expired("run-1").isEmpty());
        assertInstanceOf(ProviderResponse.Ok.class, restarted.pull(expiredRequest));
        assertEquals(provider.expired("run-1"), restarted.expired("run-1"));
        assertThrows(UnsupportedOperationException.class, () -> provider.expired("run-1").add("changed"));
        assertEquals(1, f.revision());
    }

    @Test
    void ordinaryJvmRestartReplaysCommittedStockWithoutTheOriginalSource() throws Exception {
        var first = probe("generate");
        var restarted = probe("replay");
        assertNotEquals(first.path("pid").asLong(), restarted.path("pid").asLong());
        assertTrue(first.path("generated").asBoolean());
        assertFalse(restarted.path("generated").asBoolean(true));
        assertEquals(first.path("reportDigest"), restarted.path("reportDigest"));
        assertEquals(first.path("rowsDigest"), restarted.path("rowsDigest"));
        assertEquals(first.path("pullDigest"), restarted.path("pullDigest"));
        assertEquals(first.path("expired"), restarted.path("expired"));
        assertEquals(f.cars("unreleased"), restarted.path("expired").size());
        assertEquals(1, f.revision());
    }

    private com.fasterxml.jackson.databind.JsonNode probe(String mode) throws Exception {
        Path output = Files.createTempFile("f538-jvm-restart-", ".json");
        Process process = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Xmx512m", "-cp", System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")),
                GeneratedStockRestartProbe.class.getName(), f.schema, ROOT.toString(), mode)
                .redirectError(ProcessBuilder.Redirect.INHERIT).redirectOutput(output.toFile()).start();
        try {
            assertTrue(process.waitFor(40, TimeUnit.SECONDS), "independent restart JVM timed out");
            assertEquals(0, process.exitValue(), "independent restart JVM failed");
            return SupplyFixture.JSON.readTree(Files.readString(output));
        } finally {
            if (process.isAlive()) { process.destroyForcibly(); process.waitFor(5, TimeUnit.SECONDS); }
            Files.deleteIfExists(output);
        }
    }
}
