package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import gcsp.api.evidence.StockPort.RunLookup;
import gcsp.api.evidence.StockPort.StockClassification;
import gcsp.api.evidence.StockPort.StockRead;
import gcsp.api.persistence.EnvironmentGuard;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The stock row reader over a real schema: exact identity within the caller's run, nothing from another run. */
class PersistentStockPortTest {

    static final String CONFIG = "UkVGMTpSRUZFUkVOQ0U=";
    static final String CAR_A = "5d3b1e7a-0000-4000-8000-00000000000a";
    static final String CAR_B = "5d3b1e7a-0000-4000-8000-00000000000b";
    static final EvidenceContext RUN_1 = new EvidenceContext("run-1", EvidencePgFixture.ENV, "reader", List.of("employee"));

    EvidencePgFixture f;
    StockRowReader port;

    @BeforeEach
    void setUp() throws SQLException {
        f = EvidencePgFixture.create();
        port = new StockRowReader(f.pool(), new EnvironmentGuard(f.pool(), "", EvidencePgFixture.ENV, false));
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    static String attributes(String orderNumber, String vehicleId) {
        return "{\"orderNumber\":\"" + orderNumber + "\",\"wholesalerOrderId\":\"w-1\",\"facts\":{\"syntheticIdentity\":"
                + "{\"identityKind\":\"synthetic\",\"vehicleId\":\"" + vehicleId + "\"}}}";
    }

    @Test
    void readsTheExactCarInTheCallersRun() throws SQLException {
        f.car("run-1", CAR_A, CONFIG, "released", attributes("0000451", "car-a"));
        f.car("run-1", CAR_B, CONFIG, "unreleased", attributes("0000452", "car-b"));
        StockRead a = port.read(RUN_1, CAR_A);
        assertEquals("ok", a.status());
        assertEquals("run-1", a.record().runId());
        assertEquals(CAR_A, a.record().orderUuid());
        assertEquals("0000451", a.record().orderNumber());
        assertEquals(CONFIG, a.record().configurationId());
        assertEquals("car-a", a.record().facts().get("syntheticIdentity").get("vehicleId").textValue());
        StockRead b = port.read(RUN_1, CAR_B);
        assertEquals("0000452", b.record().orderNumber());
        assertEquals("car-b", b.record().facts().get("syntheticIdentity").get("vehicleId").textValue());
    }

    @Test
    void anUnknownOrderUuidIsNotFound() {
        StockRead missing = port.read(RUN_1, CAR_A);
        assertEquals("not-found", missing.status());
        assertNull(missing.record());
        assertEquals("not-found", port.classify(RUN_1, CAR_A).status());
    }

    @Test
    void anotherRunsCarWithTheSameOrderUuidIsNotReturned() throws SQLException {
        f.retiredRun("run-0");
        f.car("run-0", CAR_A, CONFIG, "released", attributes("0000999", "old-car"));
        assertEquals("not-found", port.read(RUN_1, CAR_A).status());
        assertEquals("not-found", port.classify(RUN_1, CAR_A).status());
        f.car("run-1", CAR_A, CONFIG, "released", attributes("0000451", "car-a"));
        assertEquals("0000451", port.read(RUN_1, CAR_A).record().orderNumber());
        EvidenceContext old = new EvidenceContext("run-0", EvidencePgFixture.ENV, "reader", List.of("employee"));
        assertEquals("0000999", port.read(old, CAR_A).record().orderNumber());
    }

    @Test
    void aRetiredRunIsNotCurrentAndAnotherEnvironmentIsRefused() throws SQLException {
        RunLookup now = port.currentRun(EvidencePgFixture.ENV);
        assertEquals("ok", now.status());
        assertEquals("run-1", now.runId());
        f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-1'");
        assertEquals("source-unavailable", port.currentRun(EvidencePgFixture.ENV).status());
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-2', 'active')", EvidencePgFixture.ENV);
        assertEquals("run-2", port.currentRun(EvidencePgFixture.ENV).runId());
        assertEquals("source-unavailable", port.currentRun("other-env").status());
        assertEquals("source-unavailable", port.currentRun(null).status());
    }

    @Test
    void classifyReportsOkAndMismatch() throws SQLException {
        f.car("run-1", CAR_A, CONFIG, "released", attributes("0000451", "car-a"));
        StockClassification ok = port.classify(RUN_1, CAR_A);
        assertEquals("ok", ok.status());
        assertEquals(CONFIG, ok.configurationId());
        assertEquals("car-a", ok.vehicleId());
        f.car("run-1", CAR_B, CONFIG, "released", "{\"orderNumber\":\"0000452\",\"facts\":{\"syntheticIdentity\":{}}}");
        assertEquals("identity-mismatch", port.classify(RUN_1, CAR_B).status());
        String c = "5d3b1e7a-0000-4000-8000-00000000000c";
        f.car("run-1", c, CONFIG, "released", "{\"orderNumber\":\"0000453\"}");
        assertEquals("identity-mismatch", port.classify(RUN_1, c).status());
        assertEquals("ok", port.read(RUN_1, c).status());
        assertNull(port.read(RUN_1, c).record().facts());
    }

    @Test
    void anUntrustedContextAndAClosedDatabaseAreUnavailable() throws SQLException {
        assertEquals("source-unavailable", port.read(null, CAR_A).status());
        assertEquals("source-unavailable", port.classify(new EvidenceContext("run-1", null, "p", List.of()), CAR_A).status());
        f.close();
        f = null;
        assertEquals("source-unavailable", port.read(RUN_1, CAR_A).status());
        assertEquals("source-unavailable", port.classify(RUN_1, CAR_A).status());
    }
}
