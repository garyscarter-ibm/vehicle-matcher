package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.postgresql.util.PGobject;

/** The SQL for policy_documents and policy_versions, shared by the read source and the publication writer. */
final class PolicyRecords {

    static final String INSERT_DOCUMENT =
            "INSERT INTO policy_documents (seed_digest, document) VALUES (?, ?) ON CONFLICT DO NOTHING";
    static final String INSERT_VERSION = "INSERT INTO policy_versions (environment_id, run_id, policy_version, "
            + "effective_from, seed_digest, source_version, publisher, published_at, command_id, adoption) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    static final String INSERT_BASE_VERSION = INSERT_VERSION + " ON CONFLICT DO NOTHING";
    private static final String HEADERS = "SELECT policy_version, effective_from, seed_digest FROM policy_versions "
            + "WHERE environment_id = ? AND run_id = ? ORDER BY effective_from";
    private static final String DOCUMENTS =
            "SELECT seed_digest, document::text FROM policy_documents WHERE seed_digest = ANY(?)";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** One retained version's row: its name, instant (epoch millis) and the digest of its document. */
    record Header(String policyVersion, long effectiveFrom, String seedDigest) {

        String key() {
            return policyVersion + ":" + seedDigest;
        }
    }

    private PolicyRecords() {
    }

    static List<Header> headers(Connection c, String environmentId, String runId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(HEADERS)) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                List<Header> out = new ArrayList<>();
                while (rs.next()) {
                    out.add(new Header(rs.getString(1), rs.getObject(2, OffsetDateTime.class).toInstant().toEpochMilli(),
                            rs.getString(3)));
                }
                return out;
            }
        }
    }

    /** The documents of the given digests, parsed; a document that is not JSON is source-invalid. */
    static Map<String, JsonNode> documents(Connection c, Collection<String> digests)
            throws SQLException, PolicySourceException {
        Map<String, JsonNode> out = new HashMap<>();
        try (PreparedStatement ps = c.prepareStatement(DOCUMENTS)) {
            ps.setArray(1, c.createArrayOf("text", digests.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    try {
                        out.put(rs.getString(1), MAPPER.readTree(rs.getString(2)));
                    } catch (java.io.IOException e) {
                        throw new PolicySourceException(PolicySourceException.INVALID);
                    }
                }
            }
        }
        return out;
    }

    /** The document if it is the one its header names and its digest still matches; else source-invalid. */
    static ObjectNode verified(Header header, JsonNode document) throws PolicySourceException {
        if (document == null || !document.isObject() || !PolicyDigest.of(document).equals(header.seedDigest())) {
            throw new PolicySourceException(PolicySourceException.INVALID);
        }
        JsonNode name = document.get("policyVersion");
        JsonNode from = document.get("effectiveFrom");
        if (name == null || !name.isTextual() || !name.textValue().equals(header.policyVersion()) || from == null
                || !from.isTextual() || PolicyTime.parse(from.textValue()).orElse(Long.MIN_VALUE) != header.effectiveFrom()) {
            throw new PolicySourceException(PolicySourceException.INVALID);
        }
        return (ObjectNode) document;
    }

    /** Header and verified document of every retained version of a run, oldest first. */
    static List<ObjectNode> seeds(Connection c, String environmentId, String runId)
            throws SQLException, PolicySourceException {
        List<Header> headers = headers(c, environmentId, runId);
        Map<String, JsonNode> documents = documents(c, headers.stream().map(Header::seedDigest).distinct().toList());
        List<ObjectNode> seeds = new ArrayList<>();
        for (Header header : headers) {
            seeds.add(verified(header, documents.get(header.seedDigest())));
        }
        return seeds;
    }

    /** Runs one INSERT/UPDATE with the given parameters and returns the row count. */
    @FunctionalInterface
    interface Writer {
        int write(String sql, Object... params) throws SQLException;
    }

    /** A Writer over a plain connection (no Tx), for the read path's one-off base insert. */
    static Writer on(Connection c) {
        return (sql, params) -> {
            try (PreparedStatement ps = c.prepareStatement(sql)) {
                bind(ps, params);
                return ps.executeUpdate();
            }
        };
    }

    /** Locks the run row (the publisher's serialization point); false when the run does not exist. */
    static boolean lockRun(Connection c, String environmentId, String runId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT 1 FROM runs WHERE environment_id = ? AND run_id = ? FOR UPDATE")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    /** The validated base seed of the retained file: where every run's first version comes from. */
    static ObjectNode baseSeed(PolicySource retained, String runId) throws PolicySourceException {
        List<JsonNode> versions = retained.loadVersions(runId);
        PolicyValidation.snapshot(versions);
        if (versions.get(0) instanceof ObjectNode seed) {
            return seed;
        }
        throw new PolicySourceException(PolicySourceException.INVALID);
    }

    /** Writes a run's base version: its document (once per digest) and a version row naming itself as source. */
    static void insertBase(Writer writer, String environmentId, String runId, ObjectNode seed) throws SQLException {
        String digest = PolicyDigest.of(seed);
        Instant at = Instant.ofEpochMilli(PolicyTime.parse(seed.get("effectiveFrom").textValue()).getAsLong());
        writer.write(INSERT_DOCUMENT, digest, seed);
        writer.write(INSERT_BASE_VERSION, environmentId, runId, seed.get("policyVersion").textValue(), at, digest,
                seed.get("policyVersion").textValue(), "reviewed-repository-seed", at, null, null);
    }

    static void bind(PreparedStatement ps, Object... params) throws SQLException {
        for (int i = 0; i < params.length; i++) {
            Object p = params[i];
            if (p instanceof JsonNode json) {
                PGobject o = new PGobject();
                o.setType("jsonb");
                o.setValue(json.toString());
                ps.setObject(i + 1, o);
            } else if (p instanceof Instant instant) {
                ps.setObject(i + 1, instant.atOffset(ZoneOffset.UTC));
            } else if (p == null) {
                ps.setObject(i + 1, null);
            } else {
                ps.setObject(i + 1, p);
            }
        }
    }
}
