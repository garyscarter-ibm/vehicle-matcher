package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The one set query over Production's confirmed supply, scoped to environment and run. Needs GCSP_TEST_DATABASE_URL. */
class PostgresConfirmedSupplyLookupTest {

    @Test
    void returnsOnlyTheRunsConfirmedSupplyWithItsModelAndQuantity() throws Exception {
        try (SupplyFixture f = SupplyFixture.create()) {
            f.update("INSERT INTO production_submissions (environment_id, run_id, submission_id, command_id, requested_by, "
                    + "plan_id, plan_versions, input_digest, requested_at) VALUES (?, 'run-1', 's1', 'c1', 'p', 'plan', "
                    + "'{}'::jsonb, repeat('a', 64), now())", SupplyFixture.ENV);
            f.update("INSERT INTO production_requests (environment_id, run_id, request_id, submission_id, line_id, model, "
                    + "derivative, quantity, state, provider_mode, provider_reference, input_digest, requested_at, "
                    + "confirmed_quantity) VALUES (?, 'run-1', 'r1', 's1', 'l1', '3 Series Touring', '320i', 4, 'confirmed', "
                    + "'synthetic', 'ref', repeat('b', 64), now(), 4)", SupplyFixture.ENV);
            f.update("INSERT INTO production_confirmations (environment_id, run_id, supply_id, request_id, quantity, "
                    + "confirmed_at, source_version, provider_reference) VALUES (?, 'run-1', 'sup-1', 'r1', 2, now(), 'v', "
                    + "'ref')", SupplyFixture.ENV);
            PostgresConfirmedSupplyLookup lookup = new PostgresConfirmedSupplyLookup(() -> {
                try {
                    return f.pool();
                } catch (java.sql.SQLException e) {
                    throw new IllegalStateException(e);
                }
            }, () -> SupplyFixture.ENV);
            Map<String, ConfirmedSupplyLookup.Confirmed> found = lookup.find("run-1", List.of("sup-1", "sup-missing"));
            assertEquals(Map.of("sup-1", new ConfirmedSupplyLookup.Confirmed("3 Series Touring", "320i", 2)), found);
            assertTrue(lookup.find("run-2", List.of("sup-1")).isEmpty());
            assertTrue(new PostgresConfirmedSupplyLookup(() -> {
                try {
                    return f.pool();
                } catch (java.sql.SQLException e) {
                    throw new IllegalStateException(e);
                }
            }, () -> "other-env").find("run-1", List.of("sup-1")).isEmpty());
            assertTrue(lookup.find("run-1", List.of()).isEmpty());
        }
    }
}
