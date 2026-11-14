package gcsp.api.brief;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiConsumer;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema with an active run, the brief service over it, and settable port fixtures. */
final class BriefFixture implements AutoCloseable {

    static final String ENV = "test-env";
    static final String POLICY = "gcsp-policy-v1";
    static final Instant NOW = Instant.parse("2026-11-13T10:00:00Z");
    private static final AtomicInteger SERIAL = new AtomicInteger();
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");

    final String url;
    final String schema;
    final BriefScope scope = new BriefScope(ENV, "run-1", "emp-1", "principal-1", POLICY);
    final Policy policy = new Policy();
    final Account account = new Account();
    final Offers offers = new Offers();
    BriefService service;
    private int ids;

    private BriefFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static BriefFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_b_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SERIAL.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        BriefFixture f = new BriefFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        f.service = f.newService(f.pool());
        return f;
    }

    BriefService newService(PGSimpleDataSource pool) {
        return new BriefService(pool, policy, account, offers, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    static PGSimpleDataSource plain(String url) throws SQLException {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(url);
        return ds;
    }

    /** A new connection source bound to this schema; each call is an independent "pool". */
    PGSimpleDataSource pool() throws SQLException {
        PGSimpleDataSource ds = plain(url);
        ds.setCurrentSchema(schema);
        return ds;
    }

    String nextId() {
        return "cmd-" + (++ids);
    }

    long count(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    String text(String sql) throws SQLException {
        try (Connection c = pool().getConnection(); var rs = c.createStatement().executeQuery(sql)) {
            return rs.next() ? rs.getString(1) : null;
        }
    }

    void update(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    /** Row counts that a refused or stale command must leave exactly as they were. */
    List<Long> snapshot() throws SQLException {
        List<Long> out = new ArrayList<>();
        for (String t : List.of("brief_heads", "briefs", "brief_drafts", "command_receipts", "outbox_events")) {
            out.add(count("SELECT count(*) FROM " + t));
        }
        out.add(count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
        out.add(count("SELECT coalesce(sum(version), 0) FROM brief_heads"));
        return out;
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    /** Reads the retained Node policy seed (never a copy), optionally editing an entry before use. */
    static final class Policy implements BriefPolicyPort {
        private final Map<String, BiConsumer<ObjectNode, ObjectNode>> edits = new LinkedHashMap<>();

        /** Edit an entry's value object (the second argument) in place before the service sees it. */
        void edit(String key, java.util.function.Consumer<ObjectNode> change) {
            edits.put(key, (entry, value) -> change.accept(value));
        }

        @Override
        public Optional<BriefAssumptions> assumptions(String policyVersion) {
            try {
                JsonNode seed = Json.M.readTree(Files.readString(SEED));
                Map<String, JsonNode> entries = new LinkedHashMap<>();
                for (JsonNode a : seed.get("assumptions")) {
                    String key = a.get("key").asText();
                    if (!BriefAssumptions.KEYS.contains(key) || !policyVersion.equals(a.get("policyVersion").asText())) continue;
                    ObjectNode copy = a.deepCopy();
                    if (edits.containsKey(key) && copy.get("value") instanceof ObjectNode value) edits.get(key).accept(copy, value);
                    entries.put(key, copy);
                }
                return entries.isEmpty() ? Optional.empty() : Optional.of(new BriefAssumptions(policyVersion, entries));
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    static final class Account implements BriefAccountPort {
        volatile Optional<AccountFacts> facts = Optional.empty();

        void contract(String id, String model) {
            facts = Optional.of(new AccountFacts(new CurrentContract(id, model), "facts-1"));
        }

        @Override
        public Optional<AccountFacts> facts(String environmentId, String runId, String employeeId) {
            return facts;
        }
    }

    static final class Offers implements BriefOfferPort {
        volatile List<Offer> list = List.of();

        @Override
        public List<Offer> offers(String environmentId, String runId, String employeeId) {
            return list;
        }
    }
}
