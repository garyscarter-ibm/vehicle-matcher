package gcsp.api.demand;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.demand.OfferRecordsPort.DecisionRow;
import gcsp.api.demand.OfferRecordsPort.OfferRecords;
import gcsp.api.demand.OfferRecordsPort.OfferRow;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Comparator;
import org.junit.jupiter.api.Test;

/** The PostgreSQL offer records over migrated tables seeded with real rows, read inside a snapshot connection. */
class PostgresOfferRecordsAdapterTest {

    private static final String OTHER_RUN = "run-2";

    private static void seed(DemandFixture f, String run) throws Exception {
        f.update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) VALUES (?, ?, 'car-a', 'cfg', 'released')",
                DemandFixture.ENV, run);
        f.update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) VALUES (?, ?, 'car-b', 'cfg', 'released')",
                DemandFixture.ENV, run);
        for (String[] h : new String[][] {{"hold-1", "car-a", "1"}, {"hold-2", "car-b", "2"}}) {
            f.update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                    + "state, expires_at) VALUES (?, ?, ?, ?, 'emp-1', 'slot-1', ?, 'buddy-offer', 'active', now() + interval '1 day')",
                    DemandFixture.ENV, run, h[0], h[1], Integer.parseInt(h[2]));
        }
        f.update("INSERT INTO allocation_runs (environment_id, run_id, allocation_id, trigger_type, source_event_id, input_digest, "
                + "state, evaluated_at, clock_version, policy_version, plan, contender_count) "
                + "VALUES (?, ?, 'alloc-1', 'brief-changed', 'src-1', ?, 'pending', now(), 1, ?, '{}', 0)", DemandFixture.ENV, run,
                "1".repeat(64), DemandFixture.POLICY);
        for (String q : new String[] {"q-1", "q-2"}) {
            f.update("INSERT INTO buddy_quotes (environment_id, run_id, quote_id, allocation_id, order_uuid, employee_id, slot_id, "
                    + "configuration_id, policy_version, quoted_at, quote) VALUES (?, ?, ?, 'alloc-1', ?, 'emp-1', 'slot-1', 'cfg', ?, now(), '{}')",
                    DemandFixture.ENV, run, q, q.equals("q-1") ? "car-a" : "car-b", DemandFixture.POLICY);
        }
        offer(f, run, "offer-1", "hold-1", "q-1", "car-a", "declined", 3);
        offer(f, run, "offer-2", "hold-2", "q-2", "car-b", "active", 4);
        f.update("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, command_id, input_digest, employee_id, "
                + "hold_id, decision, reason_code, reason, versions, outcome, decided_at) "
                + "VALUES (?, ?, 'offer-1', 'dec-1', 'cmd-1', ?, 'emp-1', 'hold-1', 'decline', 'price', NULL, ?, '{}', ?)",
                DemandFixture.ENV, run, "2".repeat(64), DemandFixture.json("{\"offer\":2,\"policy\":\"" + DemandFixture.POLICY + "\",\"briefVersion\":3}"),
                java.sql.Timestamp.from(Instant.parse("2026-11-13T09:00:00Z")));
    }

    private static void offer(DemandFixture f, String run, String id, String hold, String quote, String car, String state, long brief)
            throws SQLException {
        f.update("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, employee_id, order_uuid, state, "
                + "brief_version, policy_version, expires_at) VALUES (?, ?, ?, ?, ?, 'emp-1', ?, ?, ?, ?, now() + interval '1 day')",
                DemandFixture.ENV, run, id, hold, quote, car, state, brief, DemandFixture.POLICY);
    }

    @Test
    void mapsOffersAndDecisionsOfTheRunOnlyInsideTheSnapshot() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, ?, 'retired', now())", DemandFixture.ENV, OTHER_RUN);
            for (String run : new String[] {DemandFixture.RUN, OTHER_RUN}) {
                f.update("INSERT INTO employees (environment_id, run_id, employee_id, attributes) VALUES (?, ?, 'emp-1', '{}'::jsonb)",
                        DemandFixture.ENV, run);
                f.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, 'slot-1', 'emp-1', 5)",
                        DemandFixture.ENV, run);
            }
            seed(f, DemandFixture.RUN);
            seed(f, OTHER_RUN);

            OfferRecords r;
            try (Connection c = f.pool().getConnection()) {
                c.setAutoCommit(false);
                c.setReadOnly(true);
                c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                r = new PostgresOfferRecordsAdapter().read(c, DemandFixture.SCOPE).orElseThrow();
                c.rollback();
            }
            assertEquals(2, r.offers().size());
            OfferRow one = r.offers().stream().filter(o -> o.offerId().equals("offer-1")).findFirst().orElseThrow();
            assertEquals(new OfferRow("offer-1", "emp-1", "car-a", "hold-1", "declined", 3L, DemandFixture.POLICY), one);
            assertEquals("active", r.offers().stream().sorted(Comparator.comparing(OfferRow::offerId)).toList().get(1).state());
            assertEquals(1, r.decisions().size());
            assertEquals(new DecisionRow("offer-1", "emp-1", "decline", "price", 3L, DemandFixture.POLICY), r.decisions().get(0));
            assertTrue(r.offers().stream().allMatch(o -> o.holdId() != null));
        }
    }
}
