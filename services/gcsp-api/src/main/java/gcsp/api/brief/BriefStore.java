package gcsp.api.brief;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Tx;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Explicit SQL for the brief tables. Reads take any connection; writes go through the command's Tx. */
final class BriefStore {

    record Head(long briefVersion, long draftVersion) {}

    record BriefRow(long version, Long previousVersion, String operation, ObjectNode content, ObjectNode buddy,
            String digest, String policyVersion, String accountFactsVersion, String confirmedBy, Instant confirmedAt) {}

    record DraftRow(long version, long baseBriefVersion, ObjectNode content, String digest, String policyVersion,
            String accountFactsVersion, String savedBy, Instant savedAt) {}

    private static final String BRIEF_COLUMNS = "brief_version, previous_brief_version, operation, content::text, buddy::text, "
            + "semantic_digest, policy_version, account_facts_version, confirmed_by, confirmed_at";
    private static final String DRAFT_COLUMNS = "draft_version, base_brief_version, content::text, semantic_digest, "
            + "policy_version, account_facts_version, saved_by, saved_at";

    private BriefStore() {}

    static void ensureHead(Tx tx, BriefScope s) throws SQLException {
        tx.write("INSERT INTO brief_heads (environment_id, run_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                s.environmentId(), s.runId(), s.employeeId());
    }

    static Optional<Head> head(Connection c, BriefScope s) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT brief_version, draft_version FROM brief_heads "
                + "WHERE environment_id = ? AND run_id = ? AND employee_id = ?")) {
            key(ps, s);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(new Head(rs.getLong(1), rs.getLong(2))) : Optional.empty();
            }
        }
    }

    static BriefRow brief(Connection c, BriefScope s, long version) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT " + BRIEF_COLUMNS + " FROM briefs WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ? AND brief_version = ?")) {
            key(ps, s);
            ps.setLong(4, version);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new SQLException("Brief version " + version + " is missing");
                return briefRow(rs);
            }
        }
    }

    static List<BriefRow> history(Connection c, BriefScope s) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT " + BRIEF_COLUMNS + " FROM briefs WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ? ORDER BY brief_version")) {
            key(ps, s);
            try (ResultSet rs = ps.executeQuery()) {
                List<BriefRow> rows = new ArrayList<>();
                while (rs.next()) rows.add(briefRow(rs));
                return rows;
            }
        }
    }

    static DraftRow draft(Connection c, BriefScope s, long version) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT " + DRAFT_COLUMNS + " FROM brief_drafts WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ? AND draft_version = ?")) {
            key(ps, s);
            ps.setLong(4, version);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new SQLException("Draft version " + version + " is missing");
                return new DraftRow(rs.getLong(1), rs.getLong(2), object(rs.getString(3)), rs.getString(4), rs.getString(5),
                        rs.getString(6), rs.getString(7), rs.getObject(8, OffsetDateTime.class).toInstant());
            }
        }
    }

    /** True when a confirmed version after base has exactly this semantic content (uses briefs_semantic). */
    static boolean consumed(Connection c, BriefScope s, String digest, long base) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM briefs WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ? AND semantic_digest = ? AND brief_version > ? LIMIT 1")) {
            key(ps, s);
            ps.setString(4, digest);
            ps.setLong(5, base);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    /** The one version check of a write: loses with stale-version when another writer moved either version. */
    static void casHead(Tx tx, BriefScope s, Head from, Head to, Instant now) throws SQLException {
        tx.cas("UPDATE brief_heads SET brief_version = ?, draft_version = ?, version = version + 1, updated_at = ? "
                + "WHERE environment_id = ? AND run_id = ? AND employee_id = ? AND brief_version = ? AND draft_version = ?",
                to.briefVersion(), to.draftVersion(), now, s.environmentId(), s.runId(), s.employeeId(),
                from.briefVersion(), from.draftVersion());
    }

    static void insertBrief(Tx tx, BriefScope s, BriefRow r) throws SQLException {
        tx.write("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, operation, "
                + "content, buddy, semantic_digest, policy_version, account_facts_version, confirmed_by, confirmed_at, command_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", s.environmentId(), s.runId(), s.employeeId(), r.version(),
                r.previousVersion(), r.operation(), r.content(), r.buddy(), r.digest(), r.policyVersion(),
                r.accountFactsVersion(), r.confirmedBy(), r.confirmedAt(), tx.commandId());
    }

    static void insertDraft(Tx tx, BriefScope s, DraftRow r) throws SQLException {
        tx.write("INSERT INTO brief_drafts (environment_id, run_id, employee_id, draft_version, base_brief_version, content, "
                + "semantic_digest, policy_version, account_facts_version, saved_by, saved_at, command_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", s.environmentId(), s.runId(), s.employeeId(), r.version(),
                r.baseBriefVersion(), r.content(), r.digest(), r.policyVersion(), r.accountFactsVersion(), r.savedBy(),
                r.savedAt(), tx.commandId());
    }

    private static BriefRow briefRow(ResultSet rs) throws SQLException {
        long prev = rs.getLong(2);
        return new BriefRow(rs.getLong(1), rs.wasNull() ? null : prev, rs.getString(3), object(rs.getString(4)),
                object(rs.getString(5)), rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9),
                rs.getObject(10, OffsetDateTime.class).toInstant());
    }

    private static void key(PreparedStatement ps, BriefScope s) throws SQLException {
        ps.setString(1, s.environmentId());
        ps.setString(2, s.runId());
        ps.setString(3, s.employeeId());
    }

    private static ObjectNode object(String json) throws SQLException {
        try {
            JsonNode n = Json.M.readTree(json);
            if (n instanceof ObjectNode o) return o;
        } catch (java.io.IOException e) {
            throw new SQLException("Stored brief JSON is unreadable");
        }
        throw new SQLException("Stored brief JSON is not an object");
    }
}
