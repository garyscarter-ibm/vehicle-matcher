package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.policy.RetainedFilePolicySource;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Native PostgreSQL contract, completeness and cost checks for the presenter-only projection. */
class PresenterReleaseProjectionTest {
    static final String POLICY = "gcsp-policy-v1";
    SupplyFixture f;

    @BeforeEach void setup() throws Exception { f = SupplyFixture.create(); }
    @AfterEach void close() throws Exception { if (f != null) f.close(); }

    PresenterReleaseProjection projection() throws Exception { return new PresenterReleaseProjection(f.pool(), null); }
    ObjectNode read() throws Exception { return projection().latest(SupplyFixture.ENV); }

    static void storePolicy(Connection c, String environment, String run, String version) throws Exception {
        JsonNode seed = new RetainedFilePolicySource().loadVersions(run).get(0);
        if (!version.equals(POLICY)) seed = SupplyFixture.JSON.readTree(seed.toString().replace(POLICY, version).replace("2026-11-04T00:00:00.000Z", "2026-11-03T23:59:59.000Z"));
        storePolicy(c, environment, run, seed);
    }

    static void storePolicy(Connection c, String environment, String run, JsonNode seed) throws Exception {
        String digest = Canonical.digest(seed);
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO policy_documents(seed_digest,document) VALUES (?,?::jsonb) ON CONFLICT DO NOTHING")) {
            ps.setString(1, digest); ps.setString(2, seed.toString()); ps.executeUpdate();
        }
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO policy_versions(environment_id,run_id,policy_version,effective_from,seed_digest,publisher,published_at) "
                + "VALUES (?,?,?,?::timestamptz,?,'test',now()) ON CONFLICT DO NOTHING")) {
            ps.setString(1, environment); ps.setString(2, run); ps.setString(3, seed.path("policyVersion").asText());
            ps.setString(4, seed.path("effectiveFrom").asText()); ps.setString(5, digest); ps.executeUpdate();
        }
    }

    void policy() throws Exception { try (Connection c = f.pool().getConnection()) { storePolicy(c, SupplyFixture.ENV, "run-1", POLICY); } }
    void clock() throws Exception {
        f.update("INSERT INTO run_clocks(environment_id,run_id,clock_instant,clock_version,scenario_version,fixture_version,starts_at,named_times) "
                + "VALUES (?,'run-1','2026-11-05T12:00:00Z',1,'test','test','2026-11-05T09:00:00Z','{}')", SupplyFixture.ENV);
    }
    void car(String id) throws Exception {
        ObjectNode attrs = SupplyFixture.JSON.createObjectNode();
        ObjectNode facts = attrs.putObject("facts");
        facts.putObject("display").put("name", "BMW 1 Series Sports Hatch 120 in Blue");
        ObjectNode values = facts.putObject("facts");
        values.putObject("eligibilityModelKey").put("value", "F70 Sports Hatch|120");
        values.putObject("modelLine").put("value", "F70 Sports Hatch");
        values.putObject("colour").put("value", "Blue");
        values.putObject("fuel").put("value", "petrol");
        f.update("INSERT INTO stock_cars(environment_id,run_id,order_uuid,configuration_id,state,attributes) "
                + "VALUES (?,'run-1',?,'same-configuration','released',?::jsonb)", SupplyFixture.ENV, id, attrs.toString());
    }
    void receipt(String tranche, String at, String... ids) throws Exception {
        ArrayNode cars = SupplyFixture.JSON.createArrayNode(); for (String id : ids) cars.add(id);
        f.update("INSERT INTO supply_release_ticks(environment_id,run_id,tick_id,tick_now,clock_version,input_digest,state,last_outcome) "
                + "VALUES (?,'run-1',?,?::timestamptz,1,repeat('a',64),'completed','{}')", SupplyFixture.ENV, tranche, at);
        f.update("INSERT INTO stock_releases(environment_id,run_id,tranche_id,window_id,tick_id,released_at,policy_version,source,input_digest,order_uuids,visible_order_uuids,outcome) "
                + "VALUES (?,'run-1',?,'window',?,?::timestamptz,?,'{}',repeat('a',64),?::jsonb,?::jsonb,'{}')",
                SupplyFixture.ENV, tranche, tranche, at, POLICY, cars.toString(), cars.toString());
    }
    void hold(String car, String type, String state, String offer, String expires, boolean declined) throws Exception {
        String id = "h-" + car;
        f.update("INSERT INTO employees(environment_id,run_id,employee_id) VALUES (?,'run-1',?)", SupplyFixture.ENV, id);
        f.update("INSERT INTO entitlement_slots(environment_id,run_id,slot_id,employee_id,capacity) VALUES (?,'run-1',?,?,1)", SupplyFixture.ENV, id, id);
        f.update("INSERT INTO custody_holds(environment_id,run_id,hold_id,order_uuid,employee_id,slot_id,slot_unit,hold_type,state,expires_at,attributes) "
                + "VALUES (?,'run-1',?,?,?,?,1,?,?,?::timestamptz,?::jsonb)", SupplyFixture.ENV, id, car, id, id, type, state,
                expires, declined ? "{\"releaseReason\":\"offer-declined\"}" : "{}");
        if (offer == null) return;
        f.update("INSERT INTO allocation_runs(environment_id,run_id,allocation_id,trigger_type,source_event_id,input_digest,state,evaluated_at,clock_version,policy_version,plan,contender_count) "
                + "VALUES (?,'run-1',?,'stock-released',?,repeat('a',64),'pending',now(),1,?,'{}',0)", SupplyFixture.ENV, id, id, POLICY);
        f.update("INSERT INTO buddy_quotes(environment_id,run_id,quote_id,allocation_id,order_uuid,employee_id,slot_id,configuration_id,policy_version,quoted_at,quote) "
                + "VALUES (?,'run-1',?,?,?,?,?,'same-configuration',?,now(),'{}')", SupplyFixture.ENV, id, id, car, id, id, POLICY);
        f.update("INSERT INTO buddy_offers(environment_id,run_id,offer_id,hold_id,quote_id,employee_id,order_uuid,state,brief_version,policy_version,expires_at) "
                + "VALUES (?,'run-1',?,?,?,?,?,?,1,?,?::timestamptz)", SupplyFixture.ENV, id, id, id, id, car, offer, POLICY, expires);
    }

    @Test void emptyRunIsCompleteWithoutMaterializingPolicyAndClockAbsenceIsUnknown() throws Exception {
        ObjectNode view = read();
        assertTrue(view.path("release").isNull()); assertEquals(0, view.path("counts").path("totalReleased").asInt());
        assertTrue(view.path("allocation").isNull()); assertEquals(0, view.path("cars").size());
        assertEquals(0, f.count("SELECT count(*) FROM policy_versions"));
        clock();
        assertEquals("{\"pending\":0,\"declined\":0,\"accepted\":0}", read().path("allocation").toString());
    }

    @Test void allReceiptIdsAreDistinctWhileLatestCarsRetainExactIdentityAndReceiptOrder() throws Exception {
        policy(); clock();
        for (String id : List.of("a", "b", "c")) car(id);
        receipt("first", "2026-11-05T09:00:00Z", "a", "b");
        receipt("last", "2026-11-05T10:00:00Z", "c", "b");
        ObjectNode view = read();
        assertEquals(3, view.path("counts").path("totalReleased").asInt());
        assertEquals(3, view.path("counts").path("onScheme").asInt());
        assertEquals(2, view.path("counts").path("released").asInt());
        assertEquals("c", view.path("cars").get(0).path("id").asText());
        assertEquals("b", view.path("cars").get(1).path("id").asText());
        assertEquals("BMW 1 Series Sports Hatch 120", view.path("cars").get(0).path("modelName").asText());
        assertEquals(2, view.path("charts").path("colours").get(0).path("count").asInt());
        assertEquals("800", view.path("charts").path("points").get(0).path("label").asText());
        assertEquals("Petrol", view.path("charts").path("fuel").get(0).path("label").asText());
        assertEquals("last", view.path("release").path("tickId").asText());
        assertEquals(2, view.path("release").path("visibleOrderUuids").size());
    }

    @Test void retainedPictureAndPaintAndPolicyNameFillOnlyMissingRecordedDisplayFacts() throws Exception {
        policy(); car("a"); receipt("one", "2026-11-05T09:00:00Z", "a");
        f.update("UPDATE stock_cars SET attributes = '{\"facts\":{\"facts\":{\"eligibilityModelKey\":{\"value\":\"G21 Touring|320i\"}}}}'::jsonb WHERE order_uuid='a'");
        java.nio.file.Path root = java.nio.file.Path.of("../..").toAbsolutePath().normalize();
        var catalogue = new gcsp.api.evidence.DisplayCatalogue(root.resolve("server/data/gcsp/vehicle-evidence/display-images.v1.json"), root);
        assertTrue(catalogue.available());
        JsonNode picture = catalogue.presenterImage("missing-configuration", "G21 Touring|320i");
        assertNotNull(picture);
        JsonNode car = new PresenterReleaseProjection(f.pool(),catalogue).latest(SupplyFixture.ENV).path("cars").get(0);
        assertEquals("/"+picture.path("asset").asText(),car.path("imageSrc").asText());
        assertEquals("Alpine White",car.path("colourName").asText());
        assertEquals("BMW 3 Series Touring 320i",car.path("modelName").asText());
        assertEquals("BMW 3 Series Touring 320i in Alpine White",car.path("imageAlt").asText());
        assertNull(catalogue.presenterImage("missing-configuration", "missing-model"));
    }

    @Test void actualCustodyAndOfferDecisionsDetermineRunWideTiles() throws Exception {
        policy(); clock();
        String[] ids = {"available", "buddy", "manual", "accepted", "declined", "expired", "expired-active", "pending-claim"};
        for (String id : ids) car(id);
        receipt("all", "2026-11-05T09:00:00Z", ids);
        hold("buddy", "buddy-offer", "active", "active", "2026-11-05T13:00:00Z", false);
        hold("manual", "cart", "active", null, "2026-11-05T13:00:00Z", false);
        hold("accepted", "buddy-offer", "allocated", "accepted", "2026-11-05T13:00:00Z", false);
        f.update("UPDATE stock_cars SET state='allocated' WHERE order_uuid='accepted'");
        hold("declined", "buddy-offer", "released", "declined", "2026-11-05T13:00:00Z", true);
        hold("expired", "buddy-offer", "expired", "expired", "2026-11-05T11:00:00Z", false);
        hold("expired-active", "buddy-offer", "active", "active", "2026-11-05T11:00:00Z", false);
        hold("pending-claim", "buddy-offer", "claim-pending", "decision-pending", "2026-11-05T13:00:00Z", false);
        JsonNode view = read(); JsonNode totals = view.path("counts");
        assertEquals(8, totals.path("totalReleased").asInt()); assertEquals(3, totals.path("onScheme").asInt());
        assertEquals(4, totals.path("buddyAllocated").asInt()); assertEquals(1, totals.path("manuallyAllocated").asInt());
        assertEquals("{\"pending\":1,\"declined\":1,\"accepted\":1}", view.path("allocation").toString());
    }

    @Test void missingStockRefusesButMissingOptionalPolicyKeepsTheCompleteRelease() throws Exception {
        receipt("missing-stock", "2026-11-05T09:00:00Z", "missing");
        assertThrows(PresenterReleaseProjection.Unavailable.class, this::read);
        car("missing");
        JsonNode view = read();
        assertEquals(1, view.path("counts").path("released").asInt());
        assertEquals(1, view.path("cars").size());
        assertEquals("BMW 1 Series Sports Hatch 120", view.path("cars").get(0).path("modelName").asText());
        assertEquals(0, view.path("charts").path("points").size());
        assertEquals(0, f.count("SELECT count(*) FROM policy_versions"));
    }

    @Test void corruptOptionalPolicyDigestLeavesPricingUnknownWithoutFallback() throws Exception {
        car("a"); receipt("one", "2026-11-05T09:00:00Z", "a");
        JsonNode seed = new RetainedFilePolicySource().loadVersions("run-1").get(0);
        f.update("INSERT INTO policy_documents(seed_digest,document) VALUES (repeat('b',64),?::jsonb)", seed.toString());
        f.update("INSERT INTO policy_versions(environment_id,run_id,policy_version,effective_from,seed_digest,publisher,published_at) "
                + "VALUES (?,'run-1',?,'2026-11-04T00:00:00Z',repeat('b',64),'test',now())", SupplyFixture.ENV, POLICY);
        JsonNode view = read();
        assertEquals(1, view.path("cars").size());
        assertEquals(1, view.path("counts").path("totalReleased").asInt());
        assertEquals(0, view.path("charts").path("points").size());
        assertEquals(1, f.count("SELECT count(*) FROM policy_documents"));
    }

    @Test void allocatedStockWithoutCustodyIsUnavailable() throws Exception {
        car("a"); receipt("one", "2026-11-05T09:00:00Z", "a");
        f.update("UPDATE stock_cars SET state='allocated' WHERE order_uuid='a'");
        assertThrows(PresenterReleaseProjection.Unavailable.class, this::read);
    }

    @Test void receiptPinSurvivesAnotherActivatedVersion() throws Exception {
        policy(); car("a"); receipt("one", "2026-11-05T09:00:00Z", "a");
        ObjectNode seed = (ObjectNode) new RetainedFilePolicySource().loadVersions("run-1").get(0);
        seed = (ObjectNode) SupplyFixture.JSON.readTree(seed.toString().replace(POLICY, "new-policy").replace("2026-11-04T00:00:00.000Z", "2026-11-05T10:00:00.000Z"));
        for (JsonNode row : seed.path("pricePlans")) if (row.path("matchValue").asText().equals("F70 Sports Hatch|120")) {
            ((ObjectNode) row).put("monthlyPoints", 999).put("value", 999);
        }
        try (Connection c = f.pool().getConnection()) { storePolicy(c, SupplyFixture.ENV, "run-1", seed); }
        f.update("INSERT INTO policy_run_activation(environment_id,run_id,policy_version,as_of) VALUES (?,'run-1','new-policy',now())", SupplyFixture.ENV);
        assertEquals("800", read().path("charts").path("points").get(0).path("label").asText());
    }

    @Test void nativeReadOnlySnapshotStaysCoherentAcrossConcurrentResetAndFreshReadUsesNewRun() throws Exception {
        policy(); car("a"); receipt("one", "2026-11-05T09:00:00Z", "a");
        try (Connection c = f.pool().getConnection()) {
            c.setReadOnly(true); c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ); c.setAutoCommit(false);
            var projection = projection();
            assertEquals("run-1", projection.snapshot(c, SupplyFixture.ENV).path("runId").asText());
            try (Connection reset = f.pool().getConnection(); var st = reset.createStatement()) {
                reset.setAutoCommit(false);
                st.executeUpdate("UPDATE runs SET status='retired',retired_at=now() WHERE run_id='run-1'");
                st.executeUpdate("INSERT INTO runs(environment_id,run_id,status) VALUES ('test-env','run-2','active')");
                reset.commit();
            }
            assertEquals(1, projection.snapshot(c, SupplyFixture.ENV).path("counts").path("totalReleased").asInt());
            SQLException refused = assertThrows(SQLException.class, () -> c.createStatement().executeUpdate("INSERT INTO employees(environment_id,run_id,employee_id) VALUES ('test-env','run-1','forbidden')"));
            assertEquals("25006", refused.getSQLState()); c.rollback();
        }
        assertEquals("run-2", read().path("runId").asText());
        assertEquals(0, read().path("counts").path("totalReleased").asInt());
        assertThrows(PresenterReleaseProjection.Unavailable.class, () -> projection().latest("different-env"));
    }

    @Test void nativePlansAndOperationCountCoverOneHundredLatestCarsAndHistory() throws Exception {
        policy(); clock();
        for (int i = 0; i < 300; i++) car("car-" + i);
        receipt("history", "2026-11-05T09:00:00Z", java.util.stream.IntStream.range(0,200).mapToObj(i -> "car-"+i).toArray(String[]::new));
        receipt("latest", "2026-11-05T10:00:00Z", java.util.stream.IntStream.range(200,300).mapToObj(i -> "car-"+i).toArray(String[]::new));
        AtomicInteger statements = new AtomicInteger(); DataSource delegate = f.pool();
        DataSource counted = (DataSource) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{DataSource.class}, (p,m,a) -> {
            try {
                Object answer = m.invoke(delegate,a);
                if (answer instanceof Connection connection) return Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{Connection.class}, (cp,cm,ca) -> {
                    try { if (cm.getName().equals("prepareStatement")) { assertTrue(connection.isReadOnly()); statements.incrementAndGet(); } return cm.invoke(connection,ca); }
                    catch (InvocationTargetException e) { throw e.getCause(); }
                });
                return answer;
            } catch (InvocationTargetException e) { throw e.getCause(); }
        });
        ObjectNode view = new PresenterReleaseProjection(counted,null).latest(SupplyFixture.ENV);
        assertEquals(6, statements.get()); assertEquals(100, view.path("cars").size());
        assertEquals(300, view.path("counts").path("totalReleased").asInt());
        System.out.println("PRESENTER_COST statements="+statements.get()+" latestRows=100 receiptMemberships=300 outputBytes="+view.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
        try (Connection c = f.pool().getConnection()) {
            try (var st = c.createStatement()) { st.execute("ANALYZE stock_cars"); st.execute("ANALYZE stock_releases"); st.execute("ANALYZE custody_holds"); }
            try (PreparedStatement ps = c.prepareStatement("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + PresenterReleaseProjection.TOTALS)) {
                for (int i=1;i<=6;i+=2) { ps.setString(i,SupplyFixture.ENV); ps.setString(i+1,"run-1"); }
                try (ResultSet rs=ps.executeQuery()) {
                    assertTrue(rs.next()); JsonNode plan=SupplyFixture.JSON.readTree(rs.getString(1)).get(0);
                    assertEquals(1,plan.path("Plan").path("Actual Rows").asInt());
                    System.out.println("PRESENTER_PLAN executionMs="+plan.path("Execution Time")+" sharedHits="+plan.path("Plan").path("Shared Hit Blocks")+" sharedReads="+plan.path("Plan").path("Shared Read Blocks")+" plan="+plan);
                }
            }
        }
    }
}
