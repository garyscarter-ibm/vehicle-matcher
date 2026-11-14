package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import javax.sql.DataSource;

/** Consumes the allocation triggers of the outbox in commit order, one allocation each, moving a durable cursor. */
public final class AllocationTriggers {

    private static final int PAGE = 200;
    private static final String TYPES = "('stock-released', 'brief-changed', 'buddy-expired', 'offer-declined')";

    private record Cursor(long revision, String eventId, long version) {}

    private record Event(long revision, String eventId, String type, JsonNode payload) {}

    /** A trigger and the stream position of its last event: the cursor moves there once it is allocated. */
    private record Planned(Trigger trigger, long revision, String eventId, int position) {}

    /** Raised for an event that cannot make a trigger; consumption stops before it. */
    private static final class Invalid extends Exception {
        Invalid(String message) {
            super(message);
        }
    }

    private final DataSource dataSource;
    private final AllocationService allocation;

    public AllocationTriggers(DataSource dataSource, AllocationService allocation) {
        this.dataSource = dataSource;
        this.allocation = allocation;
    }

    /** Allocates up to {@code maxTriggers} unconsumed triggers in stream order; the cursor moves only past completed ones. */
    public TriggerResult consume(AllocationScope scope, int maxTriggers) {
        String problem = scope == null ? "The allocation scope is missing." : scope.problem();
        if (problem == null && maxTriggers <= 0) problem = "The trigger limit must be positive.";
        if (problem != null) return new TriggerResult.Refused("invalid-scope", problem);
        RunContext ctx = new RunContext(scope.environmentId(), scope.runId(), AllocationService.ACTOR);
        TransactionRunner runner = new TransactionRunner(dataSource);
        List<TriggerResult.Item> items = new ArrayList<>();
        try (Connection c = dataSource.getConnection()) {
            ensureCursor(c, ctx);
            while (items.size() < maxTriggers) {
                Cursor cursor = cursor(c, ctx);
                List<Planned> plan;
                try {
                    plan = plan(c, ctx, cursor);
                } catch (Invalid e) {
                    return new TriggerResult.Refused("allocation-trigger-invalid", e.getMessage());
                }
                if (plan.isEmpty()) break;
                for (Planned p : plan) {
                    if (items.size() >= maxTriggers) break;
                    AllocationResult r = allocation.allocate(scope, p.trigger());
                    if (r instanceof AllocationResult.Pending pending) {
                        return new TriggerResult.Pending(pending.code(), pending.retryable());
                    }
                    if (r instanceof AllocationResult.Refused refused) {
                        return new TriggerResult.Refused(refused.code(), refused.message());
                    }
                    AllocationResult.Completed done = (AllocationResult.Completed) r;
                    TriggerResult stop = advance(c, runner, ctx, p);
                    if (stop != null) return stop;
                    items.add(new TriggerResult.Item(done.allocationId(), p.trigger().type(),
                            p.trigger().sourceEventId(), done.outcome().path("state").asText()));
                }
            }
            Cursor end = cursor(c, ctx);
            return new TriggerResult.Consumed(items, end.revision(), end.eventId());
        } catch (SQLException e) {
            return new TriggerResult.Pending("database-unavailable", true);
        }
    }

    private static void ensureCursor(Connection c, RunContext x) throws SQLException {
        try (var ps = c.prepareStatement("INSERT INTO allocation_trigger_cursor (environment_id, run_id) VALUES (?, ?) "
                + "ON CONFLICT DO NOTHING")) {
            ps.setString(1, x.environmentId());
            ps.setString(2, x.runId());
            ps.executeUpdate();
        }
    }

    private static Cursor cursor(Connection c, RunContext x) throws SQLException {
        Cursor cursor = Sql.one(c, "SELECT last_revision, last_event_id, version FROM allocation_trigger_cursor "
                + "WHERE environment_id = ? AND run_id = ?", rs -> new Cursor(rs.getLong(1), rs.getString(2), rs.getLong(3)),
                x.environmentId(), x.runId());
        if (cursor == null) throw new SQLException("The allocation cursor is missing");
        return cursor;
    }

    /** The next whole revisions of trigger events after the cursor, as triggers ordered by their last event. */
    private static List<Planned> plan(Connection c, RunContext x, Cursor cursor) throws SQLException, Invalid {
        List<Event> events = Sql.query(c, "SELECT run_revision, event_id, event_type, payload::text FROM outbox_events "
                + "WHERE environment_id = ? AND run_id = ? AND event_type IN " + TYPES
                + " AND (run_revision, event_id) > (?, ?) ORDER BY run_revision, event_id LIMIT ?", AllocationTriggers::event,
                x.environmentId(), x.runId(), cursor.revision(), cursor.eventId(), PAGE);
        if (events.size() == PAGE) {
            long last = events.get(events.size() - 1).revision();
            events.removeIf(e -> e.revision() == last);
            String after = last == cursor.revision() ? cursor.eventId() : "";
            events.addAll(Sql.query(c, "SELECT run_revision, event_id, event_type, payload::text FROM outbox_events "
                    + "WHERE environment_id = ? AND run_id = ? AND event_type IN " + TYPES
                    + " AND run_revision = ? AND event_id > ? ORDER BY event_id", AllocationTriggers::event,
                    x.environmentId(), x.runId(), last, after));
        }
        return build(events);
    }

    private static Event event(java.sql.ResultSet rs) throws SQLException {
        return new Event(rs.getLong(1), rs.getString(2), rs.getString(3), Sql.json(rs.getString(4)));
    }

    private static List<Planned> build(List<Event> events) throws Invalid {
        List<Planned> out = new ArrayList<>();
        // One command's lapses at one instant make one trigger: grouped by (revision, expiredAt).
        Map<String, List<Integer>> lapses = new LinkedHashMap<>();
        for (int i = 0; i < events.size(); i++) {
            Event e = events.get(i);
            switch (e.type()) {
                case "stock-released", "brief-changed" ->
                    out.add(new Planned(new Trigger(e.type(), e.eventId(), List.of(), List.of()), e.revision(), e.eventId(), i));
                case "offer-declined" -> {
                    String hold = required(e, "holdId");
                    String order = required(e, "orderUuid");
                    out.add(new Planned(new Trigger(e.type(), e.eventId(), List.of(hold), List.of(order)), e.revision(),
                            e.eventId(), i));
                }
                default -> {
                    required(e, "holdId");
                    required(e, "orderUuid");
                    lapses.computeIfAbsent(e.revision() + "|" + required(e, "expiredAt"), k -> new ArrayList<>()).add(i);
                }
            }
        }
        for (List<Integer> group : lapses.values()) {
            TreeMap<String, String> byHold = new TreeMap<>();
            for (int i : group) byHold.put(events.get(i).payload().get("holdId").textValue(),
                    events.get(i).payload().get("orderUuid").textValue());
            Event first = events.get(group.get(0));
            Event last = events.get(group.get(group.size() - 1));
            List<String> holds = new ArrayList<>(byHold.keySet());
            List<String> orders = new ArrayList<>(byHold.values());
            var pair = Sql.JSON.createArrayNode().add(first.payload().get("expiredAt").textValue());
            var ids = pair.addArray();
            holds.forEach(ids::add);
            out.add(new Planned(new Trigger("buddy-expired", "buddy-expiry:" + Canonical.digest(pair), holds, orders),
                    last.revision(), last.eventId(), group.get(group.size() - 1)));
        }
        out.sort((a, b) -> Integer.compare(a.position(), b.position()));
        return out;
    }

    private static String required(Event e, String field) throws Invalid {
        JsonNode n = e.payload().get(field);
        if (n == null || !n.isTextual() || n.textValue().isBlank()) {
            throw new Invalid("Event " + e.eventId() + " has no usable " + field + ".");
        }
        return n.textValue();
    }

    /** Moves the cursor past one allocated trigger as its own command; another worker may have got there first. */
    private TriggerResult advance(Connection c, TransactionRunner runner, RunContext ctx, Planned p) throws SQLException {
        String commandId = "allocation-cursor:" + Canonical.digest(Sql.JSON.createArrayNode().add(ctx.runId())
                .add(p.revision()).add(p.eventId()));
        Command command = new Command("allocation.cursor", commandId, Sql.JSON.createObjectNode()
                .put("revision", p.revision()).put("eventId", p.eventId()));
        for (int attempt = 0; attempt < 5; attempt++) {
            Cursor now = cursor(c, ctx);
            if (reached(c, ctx, p)) return null;
            Outcome o = AllocationService.settle(runner, ctx, commandId, () -> runner.execute(ctx, command,
                    tx -> {
                        tx.cas("UPDATE allocation_trigger_cursor SET last_revision = ?, last_event_id = ?, "
                                + "version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                                + "AND version = ? AND (last_revision, last_event_id) < (?, ?)", p.revision(),
                                p.eventId(), tx.context().environmentId(), tx.context().runId(), now.version(),
                                p.revision(), p.eventId());
                        return WorkResult.ok(Sql.JSON.createObjectNode().put("revision", p.revision())
                                .put("eventId", p.eventId()));
                    }));
            if (o instanceof Outcome.Committed) return null;
            if (o instanceof Outcome.Conflict k && "stale-version".equals(k.code())) continue;
            if (o instanceof Outcome.Refused r) return new TriggerResult.Refused(r.code(), r.message());
            if (o instanceof Outcome.Conflict k && "command-input-changed".equals(k.code())) {
                return new TriggerResult.Refused(k.code(), k.message());
            }
            return new TriggerResult.Pending(o.code(), o.retryable() || o instanceof Outcome.Uncertain);
        }
        return new TriggerResult.Pending("cursor-contended", true);
    }

    private static boolean reached(Connection c, RunContext x, Planned p) throws SQLException {
        return Boolean.TRUE.equals(Sql.one(c, "SELECT (last_revision, last_event_id) >= (?, ?) FROM "
                + "allocation_trigger_cursor WHERE environment_id = ? AND run_id = ?", rs -> rs.getBoolean(1),
                p.revision(), p.eventId(), x.environmentId(), x.runId()));
    }
}
