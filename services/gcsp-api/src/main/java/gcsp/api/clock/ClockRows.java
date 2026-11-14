package gcsp.api.clock;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/** The clock tables as records, with the selected reads that fill them (one statement each). */
final class ClockRows {

    static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    static final String CLOCK_SQL = "SELECT clock_instant, clock_version, scenario_version, fixture_version, "
            + "starts_at, named_times::text, last_tick_id, version FROM run_clocks "
            + "WHERE environment_id = ? AND run_id = ?";
    static final String LOOKUP_SQL = "SELECT c.clock_instant, c.clock_version, c.scenario_version, c.fixture_version, "
            + "c.starts_at, c.named_times::text, c.last_tick_id, c.version, r.status FROM runs r "
            + "LEFT JOIN run_clocks c ON c.environment_id = r.environment_id AND c.run_id = r.run_id "
            + "WHERE r.environment_id = ? AND r.run_id = ?";
    static final String TICK_SQL = "SELECT tick_id, kind, input_digest, target_now, target_clock_version, "
            + "policy_version, handler_order::text, missing_stages::text, outcomes::text, state, version "
            + "FROM clock_ticks WHERE environment_id = ? AND run_id = ? AND tick_id = ?";
    static final String RECEIPTS_SQL = "SELECT handler_id, input_digest, state, outcome::text "
            + "FROM clock_handler_receipts WHERE environment_id = ? AND run_id = ? AND tick_id = ?";

    private ClockRows() {}

    record Clock(Instant now, long clockVersion, String scenarioVersion, String fixtureVersion, Instant startsAt,
            Map<String, Instant> namedTimes, String lastTickId, long version) {

        ObjectNode view(String runId, ObjectNode lastTick) {
            ObjectNode out = NODES.objectNode();
            out.put("runId", runId);
            out.put("now", Instants.format(now));
            out.put("clockVersion", clockVersion);
            out.put("scenarioVersion", scenarioVersion);
            out.put("fixtureVersion", fixtureVersion);
            out.put("startsAt", Instants.format(startsAt));
            ObjectNode named = out.putObject("namedTimes");
            namedTimes.forEach((name, at) -> named.put(name, Instants.format(at)));
            out.set("lastTick", lastTick == null ? NODES.nullNode() : lastTick);
            return out;
        }
    }

    record Tick(String tickId, TickKind kind, String digest, Instant now, long clockVersion, String policyVersion,
            ArrayNode handlerOrder, ArrayNode missingStages, ArrayNode outcomes, String state, long version) {

        boolean finished() {
            return "completed".equals(state) || "pending".equals(state);
        }

        ObjectNode view(String runId) {
            ObjectNode out = NODES.objectNode();
            out.put("runId", runId);
            out.put("tickId", tickId);
            out.put("kind", kind.value());
            out.put("now", Instants.format(now));
            out.put("clockVersion", clockVersion);
            out.put("policyVersion", policyVersion);
            out.set("handlerOrder", handlerOrder.deepCopy());
            out.set("missingStages", missingStages.deepCopy());
            out.set("outcomes", outcomes.deepCopy());
            out.put("state", state);
            return out;
        }
    }

    /** The run as stored: whether it exists and is active, and its clock row if any. One statement. */
    record Lookup(boolean exists, boolean active, Clock clock) {}

    static Lookup lookup(Connection c, String environmentId, String runId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(LOOKUP_SQL)) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return new Lookup(false, false, null);
                boolean active = "active".equals(rs.getString(9));
                return new Lookup(true, active, rs.getObject(1) == null ? null : mapClock(rs));
            }
        }
    }

    static Clock mapClock(ResultSet rs) throws SQLException {
        Map<String, Instant> named = new LinkedHashMap<>();
        JsonNode stored = json(rs.getString(6));
        stored.fields().forEachRemaining(e -> named.put(e.getKey(), Instants.parse(e.getValue().textValue())));
        return new Clock(instant(rs, 1), rs.getLong(2), rs.getString(3), rs.getString(4), instant(rs, 5),
                Collections.unmodifiableMap(named), rs.getString(7), rs.getLong(8));
    }

    static Tick mapTick(ResultSet rs) throws SQLException {
        return new Tick(rs.getString(1), TickKind.of(rs.getString(2)), rs.getString(3), instant(rs, 4), rs.getLong(5),
                rs.getString(6), (ArrayNode) json(rs.getString(7)), (ArrayNode) json(rs.getString(8)),
                (ArrayNode) json(rs.getString(9)), rs.getString(10), rs.getLong(11));
    }

    static Optional<Tick> tick(Connection c, String environmentId, String runId, String tickId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(TICK_SQL)) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setString(3, tickId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(mapTick(rs)) : Optional.empty();
            }
        }
    }

    static Instant instant(ResultSet rs, int column) throws SQLException {
        return rs.getObject(column, OffsetDateTime.class).toInstant();
    }

    static JsonNode json(String text) throws SQLException {
        try {
            return JSON.readTree(text);
        } catch (JsonProcessingException e) {
            throw new SQLException("Stored clock data is unreadable");
        }
    }
}
