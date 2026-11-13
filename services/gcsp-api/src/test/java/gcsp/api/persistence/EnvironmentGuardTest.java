package gcsp.api.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.ResultSet;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class EnvironmentGuardTest {

    PgFixture f;
    String database;

    @BeforeEach
    void setUp() throws Exception {
        f = PgFixture.create();
        try (Connection c = f.pool().getConnection(); ResultSet rs = c.createStatement().executeQuery("SELECT current_database()")) {
            rs.next();
            database = rs.getString(1);
        }
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    @Test
    void emptyDatabaseIsClaimedWithTheFirstActiveRun() throws Exception {
        EnvironmentGuard guard = new EnvironmentGuard(f.pool(), database, "dev-env", false);
        EnvironmentGuard.RunState run = guard.claim();
        assertEquals("dev-env", run.environmentId());
        assertEquals("run-1", run.runId());
        assertEquals(0, run.revision());
        assertEquals(run, new EnvironmentGuard(f.pool(), database, "dev-env", false).claim());
        assertEquals(1, f.count("SELECT count(*) FROM environment_identity"));
        assertEquals(1, f.count("SELECT count(*) FROM runs"));
    }

    @Test
    void wrongExpectedDatabaseIsRefusedBeforeAnyWriteAndLeaksNoConnectionString() throws Exception {
        EnvironmentGuard guard = new EnvironmentGuard(f.pool(), "some_other_db", "dev-env", false);
        EnvironmentMismatchException e = assertThrows(EnvironmentMismatchException.class, guard::claim);
        assertTrue(e.getMessage().contains("GCSP_EXPECTED_DATABASE"));
        assertFalse(e.getMessage().contains("jdbc:"));
        assertEquals(0, f.count("SELECT count(*) FROM environment_identity"));
    }

    @Test
    void differentEnvironmentIdFromTheClaimedOneIsRefused() throws Exception {
        new EnvironmentGuard(f.pool(), database, "dev-env", false).claim();
        EnvironmentMismatchException e = assertThrows(EnvironmentMismatchException.class,
                () -> new EnvironmentGuard(f.pool(), database, "other-env", false).claim());
        assertTrue(e.getMessage().contains("GCSP_ENVIRONMENT_ID"));
    }

    @Test
    void unsetExpectedDatabaseIsRefused() throws Exception {
        assertThrows(EnvironmentMismatchException.class, () -> new EnvironmentGuard(f.pool(), "", "dev-env", false).claim());
    }
}
