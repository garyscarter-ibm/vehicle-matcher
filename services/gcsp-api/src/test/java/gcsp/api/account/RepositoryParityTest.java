package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.TreeSet;
import java.util.stream.Stream;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** The PostgreSQL provider gives every Node golden the same meaning as the records double and the HR snapshot. */
class RepositoryParityTest {

    private static final Path DIR = Paths.get("src/test/resources/account/node-baseline");

    private static void assertGolden(GoldenFixture fx, AccountOutcome actual, String name) {
        JsonNode expected = fx.golden.get("expected");
        assertEquals(expected.get("status").asText(), actual.status(), name);
        if (actual.isOk()) {
            assertEquals(expected.get("value"), actual.value(), name);
        } else {
            for (String key : List.of("status", "code", "source", "retryable", "reason", "view")) {
                assertEquals(expected.get(key), actual.refusal().get(key), name + "." + key);
            }
        }
    }

    @Test
    void everyNodeGoldenIsReproducedExactlyFromPostgreSql() throws Exception {
        TreeSet<String> names = new TreeSet<>();
        try (Stream<Path> files = Files.list(DIR)) {
            files.map(f -> f.getFileName().toString()).filter(f -> f.endsWith(".json"))
                    .forEach(f -> names.add(f.substring(0, f.length() - 5)));
        }
        assertTrue(names.size() >= 11, "golden set shrank: " + names);
        for (String name : names) {
            GoldenFixture fx = new GoldenFixture(name);
            try (RepositoryFixture db = RepositoryFixture.create()) {
                db.claim(fx);
                db.seed(fx);
                assertGolden(fx, fx.service(db.records()).readAccount(fx.scope), name);
            }
        }
    }

    @Test
    void changedFactsChangeTheOutcome() throws Exception {
        GoldenFixture fx = new GoldenFixture("paula");
        try (RepositoryFixture db = RepositoryFixture.create()) {
            db.claim(fx);
            db.seed(fx);
            AccountService service = fx.service(db.records());
            assertEquals("ready", service.readAccount(fx.scope).value().get("state").asText());

            db.update("UPDATE entitlement_slots SET attributes = jsonb_set(attributes, '{state}', '\"disabled\"') "
                    + "WHERE environment_id = ? AND run_id = ?", fx.scope.environmentId(), fx.scope.runId());
            assertEquals("no-entitlement", service.readAccount(fx.scope).value().get("state").asText());

            db.update("DELETE FROM employee_account_records WHERE environment_id = ? AND run_id = ?",
                    fx.scope.environmentId(), fx.scope.runId());
            assertEquals("absent-hr-account", service.readAccount(fx.scope).value().get("state").asText());
        }
    }

    @Test
    void aMissingKeyIsNeverRepaired() throws Exception {
        GoldenFixture fx = new GoldenFixture("paula");
        try (RepositoryFixture db = RepositoryFixture.create()) {
            db.claim(fx);
            db.seed(fx);
            db.update("UPDATE employee_account_records SET record = record - 'account'");
            assertFalse(db.records().readEmployeeContract(fx.scope).value().has("account"));
            assertEquals("unavailable", fx.service(db.records()).readAccount(fx.scope).status());

            db.update("UPDATE employees SET attributes = attributes - 'gradeId'");
            assertFalse(db.records().readEmployment(fx.scope.environmentId(), fx.scope.runId(), fx.scope.employeeId())
                    .value().has("gradeId"));
            assertEquals("employee-contract-invalid",
                    fx.service(db.records()).readAccount(fx.scope).refusal().get("source").asText());
        }
    }

    @Test
    void slotsComeBackOrderedWithMillisecondUtcTimestamps() throws Exception {
        GoldenFixture fx = new GoldenFixture("paula");
        try (RepositoryFixture db = RepositoryFixture.create()) {
            db.claim(fx);
            db.seed(fx);
            db.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, created_at, updated_at) "
                    + "VALUES (?, ?, 'a-first', ?, 2, '2026-11-05 10:00:00+01', '2026-11-05 09:00:00.5+00')",
                    fx.scope.environmentId(), fx.scope.runId(), fx.scope.employeeId());
            JsonNode slots = db.records().readEmployeeContract(fx.scope).value().get("slots");
            assertEquals("a-first", slots.get(0).get("entitlementSlotId").asText());
            assertEquals("2026-11-05T09:00:00.000Z", slots.get(0).get("createdAt").asText());
            assertEquals("2026-11-05T09:00:00.500Z", slots.get(0).get("updatedAt").asText());
            assertFalse(slots.get(0).has("state"));
            assertEquals("slot-paula", slots.get(1).get("entitlementSlotId").asText());
        }
    }

    @Test
    void databaseFailuresAreUnavailableWithoutSqlOrConnectionText() throws Exception {
        GoldenFixture fx = new GoldenFixture("paula");
        try (RepositoryFixture db = RepositoryFixture.create()) {
            db.claim(fx);
            db.seed(fx);
            db.update("ALTER TABLE employee_account_records RENAME TO hidden_records");
            assertUnavailable(fx, db.records());
            assertEquals(SourceResult.UNAVAILABLE, db.records().readDrivers(fx.scope).status());
        }
        PGSimpleDataSource unreachable = new PGSimpleDataSource();
        unreachable.setUrl("jdbc:postgresql://127.0.0.1:1/secret_db?user=nobody");
        unreachable.setLoginTimeout(2);
        assertUnavailable(fx, new RepositoryAccountRecords(unreachable));
        assertUnavailable(fx, new RepositoryAccountRecords(new PGSimpleDataSource() {
            @Override
            public Connection getConnection() throws SQLException {
                throw new SQLException("connection to jdbc:postgresql://secret-host failed: SELECT attributes FROM employees");
            }
        }));
    }

    private static void assertUnavailable(GoldenFixture fx, AccountRecordsPort records) throws IOException {
        AccountOutcome out = fx.service(records).readAccount(fx.scope);
        assertEquals("unavailable", out.status());
        assertEquals("employee-contract", out.refusal().get("source").asText());
        String body = out.refusal().toString();
        for (String leak : List.of("SELECT", "jdbc", "relation", "secret", "hidden_records", "employee_account_records")) {
            assertFalse(body.contains(leak), leak);
        }
    }
}
