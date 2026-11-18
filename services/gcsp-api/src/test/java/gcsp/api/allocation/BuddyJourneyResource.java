package gcsp.api.allocation;

import gcsp.api.remote.RemoteOperationServer;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.postgresql.ds.PGSimpleDataSource;

/** Owns one migrated schema, seeded source rows, a plan file under TMPDIR and (in remote mode) a scripted Buddy. */
public class BuddyJourneyResource implements QuarkusTestResourceLifecycleManager {

    private boolean remoteMode;
    private RemoteOperationServer remote;
    private String url;
    private String schema;
    private Path dir;

    @Override
    public void init(Map<String, String> args) {
        remoteMode = "remote".equals(args.get("mode"));
    }

    @Override
    public Map<String, String> start() {
        url = System.getenv("GCSP_TEST_DATABASE_URL");
        if (url == null || url.isBlank()) throw new IllegalStateException("GCSP_TEST_DATABASE_URL is required");
        try {
            schema = "gcsp_j_" + Long.toHexString(System.nanoTime());
            dir = Files.createTempDirectory(tmpRoot(), "buddy-journey-");
            Path plan = dir.resolve("tranche-plan.json");
            Instant wall = Instant.now();
            Files.writeString(plan, BuddyJourneySeed.plan(remoteMode, wall));
            PGSimpleDataSource plain = new PGSimpleDataSource();
            plain.setUrl(url);
            Flyway.configure().dataSource(plain).schemas(schema).defaultSchema(schema).createSchemas(true)
                    .locations("classpath:db/migration").load().migrate();
            BuddyJourneySeed.seed(url, schema, remoteMode, wall);
            Map<String, String> c = new HashMap<>();
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", url);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", schema);
            c.put("quarkus.flyway.schemas", schema);
            c.put("quarkus.flyway.default-schema", schema);
            c.put("gcsp.supply.tranche-plan-file", plan.toAbsolutePath().toString());
            if (remoteMode) {
                remote = RemoteOperationServer.start();
                c.put("gcsp.buddy.execute-url", remote.baseUrl() + "/execute");
                c.put("gcsp.buddy.reconcile-url", remote.baseUrl() + "/reconcile");
                c.put("gcsp.buddy.timeout", "2s");
            }
            return c;
        } catch (Exception e) {
            RuntimeException cleanup = close();
            if (cleanup != null) e.addSuppressed(cleanup);
            throw new IllegalStateException("Buddy journey resource failed to start", e);
        }
    }

    @Override
    public void inject(TestInjector injector) {
        if (remote != null) {
            injector.injectIntoFields(remote,
                    new TestInjector.AnnotatedAndMatchesType(InjectBuddyRemote.class, RemoteOperationServer.class));
        }
    }

    @Override
    public void stop() {
        RuntimeException failure = close();
        if (failure != null) throw failure;
    }

    private static Path tmpRoot() {
        String t = System.getenv("TMPDIR");
        return Path.of(t != null && !t.isBlank() ? t : System.getProperty("java.io.tmpdir"));
    }

    private RuntimeException close() {
        RuntimeException failure = null;
        if (remote != null) {
            remote.close();
            remote = null;
        }
        if (dir != null) {
            try {
                try (var files = Files.list(dir)) {
                    for (Path p : files.toList()) Files.deleteIfExists(p);
                }
                Files.deleteIfExists(dir);
            } catch (IOException e) {
                failure = new IllegalStateException("Could not remove the journey plan directory", e);
            }
            dir = null;
        }
        if (schema != null && url != null) {
            PGSimpleDataSource plain = new PGSimpleDataSource();
            plain.setUrl(url);
            try (Connection c = plain.getConnection(); var st = c.createStatement()) {
                st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            } catch (Exception e) {
                if (failure == null) failure = new IllegalStateException("Could not drop the journey schema", e);
                else failure.addSuppressed(e);
            }
            schema = null;
        }
        return failure;
    }
}
