package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.Work;
import gcsp.api.persistence.WorkResult;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;

/** Releases exact stock on a delivered tick; every write is a TransactionRunner command, the pull is outside any. */
public final class StockRelease {

    static final String ACTOR = "system:stock-release";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_RACE_RETRIES = 2;
    private static final String CLOCK_CHANGED = "release-clock-changed";
    private static final String OCCUPYING = ReleasedStock.OCCUPYING;

    private final DataSource dataSource;
    private final ReleasePolicy policy;
    private final SupplyProvider provider;
    private final TransactionRunner runner;

    public StockRelease(DataSource dataSource, ReleasePolicy policy, SupplyProvider provider) {
        this.dataSource = dataSource;
        this.policy = policy;
        this.provider = provider;
        this.runner = new TransactionRunner(dataSource);
    }

    private static RunContext actor(RunContext scope) {
        return new RunContext(scope.environmentId(), scope.runId(), ACTOR);
    }

    // ---- delivery ----

    /** Records the tick durably, then processes it; redelivering the same tickId completes an unfinished tick. */
    public ReleaseResult deliver(RunContext scope, TickEvent tick) {
        if (tick == null || !tick.valid()) {
            return ReleaseResult.invalid(tick == null ? null : tick.tickId(), "invalid-tick", "The tick is malformed.");
        }
        RunContext ctx = actor(scope);
        ObjectNode input = JSON.createObjectNode();
        input.put("tickId", tick.tickId());
        input.put("now", Iso.format(tick.now()));
        input.put("clockVersion", tick.clockVersion());
        Outcome recorded = runner.execute(ctx, new Command("supply.tick.deliver", "tick:" + tick.tickId(), input),
                tx -> recordTick(tx, tick, Canonical.digest(input)));
        ReleaseResult failed = deliveryFailure(recorded, tick.tickId());
        if (failed != null) return failed;
        try {
            Optional<TickRow> row = read(ctx, tick.tickId());
            if (row.isEmpty()) return ReleaseResult.unavailable(tick.tickId(), "tick-missing", "The tick is not stored.");
            return handle(ctx, row.get());
        } catch (SQLException e) {
            return databaseDown(tick.tickId());
        }
    }

    private static ReleaseResult deliveryFailure(Outcome o, String tickId) {
        if (o instanceof Outcome.Committed) return null;
        if (o instanceof Outcome.Uncertain) return ReleaseResult.uncertain(tickId);
        if (o instanceof Outcome.Conflict c) {
            String code = "command-input-changed".equals(c.code()) ? "tick-input-changed" : c.code();
            return ReleaseResult.conflict(tickId, code, c.message(), c.retryable());
        }
        if (o instanceof Outcome.Refused r) return ReleaseResult.invalid(tickId, r.code(), r.message());
        return databaseDown(tickId);
    }

    private static WorkResult recordTick(Tx tx, TickEvent tick, String digest) throws SQLException {
        RunContext c = tx.context();
        Optional<long[]> top = latestClock(tx);
        if (top.isPresent()) {
            long version = top.get()[0];
            Instant at = Instant.ofEpochMilli(top.get()[1]);
            boolean bad = tick.clockVersion() < version
                    || (tick.clockVersion() == version && !tick.now().equals(at))
                    || (tick.clockVersion() > version && !tick.now().isAfter(at));
            if (bad) throw new TxConflict(CLOCK_CHANGED, "The tick does not follow the run's clock.");
        }
        tx.write("INSERT INTO supply_release_ticks (environment_id, run_id, tick_id, tick_now, clock_version, "
                + "input_digest, state) VALUES (?, ?, ?, ?, ?, ?, 'pending')", c.environmentId(), c.runId(),
                tick.tickId(), tick.now(), tick.clockVersion(), digest);
        return WorkResult.ok(JSON.createObjectNode().put("delivered", true));
    }

    /** The run's latest delivered clock as {version, epochMillis}, by the clock index. */
    private static Optional<long[]> latestClock(Tx tx) throws SQLException {
        RunContext c = tx.context();
        return tx.first("SELECT clock_version, tick_now FROM supply_release_ticks WHERE environment_id = ? "
                + "AND run_id = ? ORDER BY clock_version DESC, delivered_seq DESC LIMIT 1",
                rs -> new long[] {rs.getLong(1), rs.getObject(2, OffsetDateTime.class).toInstant().toEpochMilli()},
                c.environmentId(), c.runId());
    }

    /** Completes up to limit pending ticks in delivery order using a keyset cursor over the pending index. */
    public List<ReleaseResult> reconcilePending(RunContext scope, int limit) {
        if (limit <= 0) throw new IllegalArgumentException("limit must be positive");
        RunContext ctx = actor(scope);
        List<ReleaseResult> results = new ArrayList<>();
        long cursor = 0;
        while (results.size() < limit) {
            List<TickRow> page;
            try {
                page = pendingAfter(ctx, cursor, Math.min(limit - results.size(), 100));
            } catch (SQLException e) {
                results.add(databaseDown(null));
                break;
            }
            if (page.isEmpty()) break;
            for (TickRow row : page) {
                cursor = row.deliveredSeq();
                results.add(handle(ctx, row));
            }
        }
        return results;
    }

    private List<TickRow> pendingAfter(RunContext ctx, long cursor, int size) throws SQLException {
        String sql = "SELECT " + ReleasedStock.TICK_COLUMNS + " FROM supply_release_ticks WHERE environment_id = ? "
                + "AND run_id = ? AND state = 'pending' AND delivered_seq > ? ORDER BY delivered_seq LIMIT ?";
        List<TickRow> rows = new ArrayList<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setLong(3, cursor);
            ps.setInt(4, size);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) rows.add(ReleasedStock.tickRow(rs));
            }
        }
        return rows;
    }

    private Optional<TickRow> read(RunContext ctx, String tickId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return ReleasedStock.readTick(c, ctx, tickId);
        }
    }

    private static ReleaseResult databaseDown(String tickId) {
        return ReleaseResult.unavailable(tickId, "database-unavailable", "The database could not be reached.");
    }

    // ---- processing ----

    private ReleaseResult handle(RunContext ctx, TickRow row) {
        if (!"pending".equals(row.state())) return stored(row);
        ReleaseResult result = null;
        for (int tries = 0; tries <= MAX_RACE_RETRIES; tries++) {
            result = attempt(ctx, row);
            boolean race = result.status() == ReleaseResult.Status.CONFLICT
                    && ("duplicate-record".equals(result.code()) || "stale-version".equals(result.code()));
            if (!race) break;
            try {
                Optional<TickRow> now = read(ctx, row.tickId());
                if (now.isPresent() && !"pending".equals(now.get().state())) return stored(now.get());
            } catch (SQLException e) {
                return databaseDown(row.tickId());
            }
        }
        boolean raced = result.status() == ReleaseResult.Status.CONFLICT
                && ("duplicate-record".equals(result.code()) || "stale-version".equals(result.code()));
        if (raced) {
            result = ReleaseResult.unavailable(row.tickId(), "release-contention", "A competing release is in progress.");
        }
        return settle(ctx, row, result);
    }

    static ReleaseResult stored(TickRow row) {
        JsonNode o = row.lastOutcome();
        String status = o == null ? "unavailable" : o.path("status").asText("unavailable");
        ReleaseResult.Status s = ReleaseResult.Status.valueOf(status.toUpperCase());
        return new ReleaseResult(s, o == null ? "pending" : o.path("code").asText("ok"),
                o == null ? null : o.path("reason").asText(null), o != null && o.path("retryable").asBoolean(false),
                row.tickId(), s != ReleaseResult.Status.UNAVAILABLE, o == null || o.path("value").isMissingNode()
                        ? null : o.get("value"));
    }

    private static ObjectNode envelope(ReleaseResult r) {
        ObjectNode o = JSON.createObjectNode();
        o.put("status", r.status().name().toLowerCase());
        o.put("code", r.code());
        if (r.reason() != null) o.put("reason", r.reason());
        o.put("retryable", r.retryable());
        if (r.value() != null) o.set("value", r.value());
        return o;
    }

    private static ObjectNode okEnvelope(JsonNode outcome) {
        ObjectNode o = JSON.createObjectNode();
        o.put("status", "ok");
        o.put("code", "ok");
        o.put("retryable", false);
        o.set("value", outcome);
        return o;
    }

    /** Records a failed attempt (retryable: stays pending) or the final refusal; a competing finisher wins. */
    private ReleaseResult settle(RunContext ctx, TickRow row, ReleaseResult result) {
        if (result.status() == ReleaseResult.Status.OK || result.status() == ReleaseResult.Status.UNCERTAIN
                || "stale-run".equals(result.code())) {
            return result;
        }
        boolean retryable = result.retryable();
        ObjectNode input = JSON.createObjectNode().put("tickId", row.tickId());
        String commandId;
        String type;
        String sql;
        if (retryable) {
            input.put("attempts", row.attempts());
            commandId = "release-attempt:" + row.tickId() + ":" + row.attempts();
            type = "supply.release.attempt";
            sql = "UPDATE supply_release_ticks SET attempts = attempts + 1, last_outcome = ?, version = version + 1, "
                    + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND tick_id = ? AND state = 'pending'";
        } else {
            commandId = "release-refused:" + row.tickId();
            type = "supply.release.refuse";
            sql = "UPDATE supply_release_ticks SET state = 'refused', last_outcome = ?, version = version + 1, "
                    + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND tick_id = ? AND state = 'pending'";
        }
        ObjectNode env = envelope(result);
        Outcome o = runner.execute(ctx, new Command(type, commandId, input), tx -> {
            tx.cas(sql, env, ctx.environmentId(), ctx.runId(), row.tickId());
            return WorkResult.ok(env);
        });
        if (o instanceof Outcome.Uncertain) return ReleaseResult.uncertain(row.tickId());
        if (o instanceof Outcome.Conflict) {
            try {
                Optional<TickRow> now = read(ctx, row.tickId());
                if (now.isPresent() && !"pending".equals(now.get().state())) return stored(now.get());
            } catch (SQLException e) {
                return databaseDown(row.tickId());
            }
        }
        return result;
    }

    /** One pass: clock, policy, reads, pull, validation, then the release transaction. Unsettled on failure. */
    private ReleaseResult attempt(RunContext ctx, TickRow tick) {
        String id = tick.tickId();
        PullRequest request;
        PolicyReading.Ok config;
        try {
            Optional<long[]> top = topClock(ctx);
            if (top.isPresent() && tick.clockVersion() != top.get()[0]) {
                return ReleaseResult.conflict(id, CLOCK_CHANGED, "The run's clock moved past this tick.", false);
            }
            PolicyReading reading = policy.read(ctx.runId(), tick.now());
            if (reading instanceof PolicyReading.Unavailable u) {
                return ReleaseResult.unavailable(id, "policy-unavailable", u.reason());
            }
            config = (PolicyReading.Ok) reading;
            request = new PullRequest(ctx.runId(), tick.now(), id, config.releaseSize(), config.leadTimeDays(),
                    config.policyVersion(), releasedTranches(ctx), queuedSupply(ctx));
        } catch (SQLException e) {
            return databaseDown(id);
        } catch (RuntimeException e) {
            return ReleaseResult.unavailable(id, "policy-unavailable", "The release policy could not be read.");
        }
        ProviderResponse response;
        try {
            response = provider.pull(request);
        } catch (RuntimeException e) {
            return ReleaseResult.unavailable(id, "stock-source-unavailable", "Stock source is unavailable.");
        }
        if (response instanceof ProviderResponse.Unavailable u) {
            return ReleaseResult.unavailable(id, u.code(), u.reason());
        }
        if (!(response instanceof ProviderResponse.Ok ok)) {
            return ReleaseResult.invalid(id, "invalid-stock-pull", "Expected a complete stock-list outcome.");
        }
        if (PullValidator.isStale(ok.value(), tick.now(), config.stockSourceMaxAgeMinutes())) {
            return ReleaseResult.unavailable(id, "stock-source-stale", "Stock source data is older than the policy age.");
        }
        PullValidator.Result checked = PullValidator.validate(ok.value(), ctx.runId(), tick.now());
        if (checked instanceof PullValidator.Invalid bad) {
            return ReleaseResult.invalid(id, "invalid-stock-pull", bad.field() + ": " + bad.reason());
        }
        PullValidator.Snapshot snapshot = ((PullValidator.Valid) checked).snapshot();
        ObjectNode input = JSON.createObjectNode();
        input.put("tickId", id);
        input.put("tickDigest", tick.inputDigest());
        input.put("snapshotDigest", Canonical.digest(snapshot.raw()));
        Outcome o = runner.execute(ctx, new Command("supply.release", "release:" + id, input),
                tx -> release(tx, tick, config, snapshot));
        return fromRelease(ctx, tick, o);
    }

    private ReleaseResult fromRelease(RunContext ctx, TickRow tick, Outcome o) {
        String id = tick.tickId();
        if (o instanceof Outcome.Committed c) {
            return stored(new TickRow(id, tick.now(), tick.clockVersion(), tick.inputDigest(),
                    "completed", tick.attempts(), tick.version(), tick.deliveredSeq(), c.result()), c.replayed());
        }
        if (o instanceof Outcome.Uncertain) return ReleaseResult.uncertain(id);
        if (o instanceof Outcome.Conflict c) {
            if ("tick-already-handled".equals(c.code()) || "command-input-changed".equals(c.code())) {
                try {
                    Optional<TickRow> now = read(ctx, id);
                    if (now.isPresent() && !"pending".equals(now.get().state())) return stored(now.get());
                } catch (SQLException e) {
                    return databaseDown(id);
                }
            }
            boolean retry = c.retryable() && !"stale-version".equals(c.code());
            return ReleaseResult.conflict(id, c.code(), c.message(), retry);
        }
        if (o instanceof Outcome.Refused r) {
            return ReleaseResult.invalid(id, r.code(), r.message());
        }
        return databaseDown(id);
    }

    private static ReleaseResult stored(TickRow row, boolean replayed) {
        ReleaseResult r = stored(row);
        return new ReleaseResult(r.status(), r.code(), r.reason(), r.retryable(), r.tickId(), replayed, r.value());
    }

    private Optional<long[]> topClock(RunContext ctx) throws SQLException {
        String sql = "SELECT clock_version FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "ORDER BY clock_version DESC, delivered_seq DESC LIMIT 1";
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(new long[] {rs.getLong(1)}) : Optional.empty();
            }
        }
    }

    private List<PullRequest.Released> releasedTranches(RunContext ctx) throws SQLException {
        String sql = "SELECT tranche_id, order_uuids::text FROM stock_releases WHERE environment_id = ? AND run_id = ? "
                + "ORDER BY released_at, tranche_id";
        List<PullRequest.Released> out = new ArrayList<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    List<String> ids = new ArrayList<>();
                    for (JsonNode n : ReleasedStock.json(rs.getString(2))) ids.add(n.asText());
                    out.add(new PullRequest.Released(rs.getString(1), List.copyOf(ids)));
                }
            }
        }
        return out;
    }

    private List<PullRequest.QueuedSupply> queuedSupply(RunContext ctx) throws SQLException {
        String sql = "SELECT supply_id, confirmed_at, eligible_from, source_version, policy_version "
                + "FROM confirmed_supply_queue WHERE environment_id = ? AND run_id = ? ORDER BY supply_id";
        List<PullRequest.QueuedSupply> out = new ArrayList<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new PullRequest.QueuedSupply(rs.getString(1),
                            rs.getObject(2, OffsetDateTime.class).toInstant(),
                            rs.getObject(3, OffsetDateTime.class).toInstant(), rs.getString(4), rs.getString(5)));
                }
            }
        }
        return out;
    }

    // ---- the release transaction ----

    private record Known(String configurationId, String state, long version, JsonNode attributes) {}

    private static WorkResult release(Tx tx, TickRow tick, PolicyReading.Ok config, PullValidator.Snapshot snap)
            throws SQLException {
        RunContext c = tx.context();
        Instant now = tick.now();
        Optional<Object[]> locked = tx.first("SELECT state, version FROM supply_release_ticks WHERE environment_id = ? "
                + "AND run_id = ? AND tick_id = ? FOR UPDATE", rs -> new Object[] {rs.getString(1), rs.getLong(2)},
                c.environmentId(), c.runId(), tick.tickId());
        if (locked.isEmpty() || !"pending".equals(locked.get()[0])) {
            throw new TxConflict("tick-already-handled", "A competing instance already handled this tick.");
        }
        long tickVersion = (Long) locked.get()[1];
        Optional<long[]> top = latestClock(tx);
        if (top.isPresent() && top.get()[0] != tick.clockVersion()) {
            throw new TxConflict(CLOCK_CHANGED, "The run's clock moved past this tick.");
        }
        PullValidator.Tranche tranche = snap.tranche();
        Map<String, Known> known = knownCars(tx, snap.stock());
        for (ObjectNode car : snap.stock()) {
            Known k = known.get(car.get("orderUuid").asText());
            if (k != null && !identityMatches(k, car)) {
                throw new TxConflict("stock-identity-changed", "A known car changed its identity.");
            }
        }
        for (ObjectNode car : snap.stock()) {
            Known k = known.get(car.get("orderUuid").asText());
            boolean seen = k != null && !"unreleased".equals(k.state());
            if (!seen && (tranche == null || !tranche.orderUuids().contains(car.get("orderUuid").asText()))) {
                return WorkResult.refuse("invalid-stock-pull", "Unreleased cars must belong to the reported tranche.");
            }
        }
        if (tranche == null) {
            ObjectNode out = JSON.createObjectNode();
            out.put("kind", "no-release");
            out.put("runId", c.runId());
            out.put("tickId", tick.tickId());
            out.putArray("orderUuids");
            return complete(tx, tick, tickVersion, out);
        }
        List<ObjectNode> exact = new ArrayList<>();
        for (ObjectNode car : snap.stock()) if (tranche.orderUuids().contains(car.get("orderUuid").asText())) exact.add(car);
        ObjectNode digestInput = JSON.createObjectNode();
        digestInput.set("tranche", tranche.node());
        ArrayNode exactNodes = digestInput.putArray("stock");
        exact.forEach(exactNodes::add);
        digestInput.set("source", snap.source());
        String digest = Canonical.digest(digestInput);
        Optional<String[]> receipt = tx.first("SELECT input_digest, outcome::text FROM stock_releases "
                + "WHERE environment_id = ? AND run_id = ? AND tranche_id = ?",
                rs -> new String[] {rs.getString(1), rs.getString(2)}, c.environmentId(), c.runId(),
                tranche.trancheId());
        if (receipt.isPresent()) {
            if (!receipt.get()[0].equals(digest)) {
                throw new TxConflict("tranche-input-changed", "The tranche id was reused with different input.");
            }
            return complete(tx, tick, tickVersion, ReleasedStock.json(receipt.get()[1]));
        }
        if (tranche.orderUuids().size() > config.releaseSize()) {
            return WorkResult.refuse("invalid-stock-pull", "tranche: Release exceeds the policy size.");
        }
        if (tranche.supplyId() != null) {
            Optional<Instant> eligible = tx.first("SELECT eligible_from FROM confirmed_supply_queue "
                    + "WHERE environment_id = ? AND run_id = ? AND supply_id = ?",
                    rs -> rs.getObject(1, OffsetDateTime.class).toInstant(), c.environmentId(), c.runId(),
                    tranche.supplyId());
            if (eligible.isEmpty()) return WorkResult.refuse("supply-not-queued", "Supply has not been confirmed and queued.");
            if (eligible.get().isAfter(now)) {
                return WorkResult.refuse("supply-before-lead-time", "Confirmed supply is outside its policy lead time.");
            }
        }
        Set<String> held = occupied(tx, known);
        ObjectNode release = JSON.createObjectNode();
        release.put("trancheId", tranche.trancheId());
        release.put("windowId", tranche.windowId());
        if (tranche.supplyId() == null) release.putNull("supplyId"); else release.put("supplyId", tranche.supplyId());
        release.put("releasedAt", Iso.format(now));
        release.put("policyVersion", config.policyVersion());
        release.put("sourceVersion", snap.source().get("version").asText());
        ArrayNode added = JSON.createArrayNode();
        for (ObjectNode car : snap.stock()) {
            String uuid = car.get("orderUuid").asText();
            Known k = known.get(uuid);
            if (k != null && (!"unreleased".equals(k.state()) || k.attributes().has("release"))) continue;
            if (k != null && held.contains(uuid)) {
                throw new TxConflict("unreleased-stock-occupied", "An unreleased car is held.");
            }
            if (!tranche.orderUuids().contains(uuid)) {
                return WorkResult.refuse("invalid-stock-pull", "tranche: Car is not in this release.");
            }
            JsonNode until = car.path("availability").path("availableUntil");
            Instant end = until.isTextual() ? Iso.parse(until.asText()) : null;
            if (end != null && !end.isAfter(now)) {
                return WorkResult.refuse("invalid-stock-pull", "availability: The source availability interval has ended.");
            }
            ObjectNode availability = JSON.createObjectNode();
            availability.put("state", "available");
            availability.put("availableFrom", Iso.format(now));
            availability.put("version", tranche.trancheId());
            if (end != null) availability.put("availableUntil", until.asText());
            ObjectNode attrs = car.deepCopy();
            attrs.remove(List.of("orderUuid", "configurationId", "availability"));
            ObjectNode carRelease = release.deepCopy();
            carRelease.set("availability", availability);
            attrs.set("release", carRelease);
            if (k == null) {
                tx.write("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, "
                        + "attributes) VALUES (?, ?, ?, ?, 'released', ?)", c.environmentId(), c.runId(), uuid,
                        car.get("configurationId").asText(), attrs);
            } else {
                tx.cas("UPDATE stock_cars SET state = 'released', attributes = attributes || ?, "
                        + "version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                        + "AND order_uuid = ? AND version = ?", attrs, c.environmentId(), c.runId(), uuid, k.version());
            }
            added.add(uuid);
        }
        ObjectNode out = JSON.createObjectNode();
        out.put("kind", "stock-released");
        out.put("runId", c.runId());
        out.put("trancheId", tranche.trancheId());
        out.put("windowId", tranche.windowId());
        if (tranche.supplyId() == null) out.putNull("supplyId"); else out.put("supplyId", tranche.supplyId());
        out.put("tickId", tick.tickId());
        out.put("releasedAt", Iso.format(now));
        out.set("orderUuids", added);
        ArrayNode visible = out.putArray("visibleOrderUuids");
        tranche.orderUuids().forEach(visible::add);
        out.put("policyVersion", config.policyVersion());
        out.set("source", snap.source());
        tx.write("INSERT INTO stock_releases (environment_id, run_id, tranche_id, window_id, supply_id, tick_id, "
                + "released_at, policy_version, source, input_digest, order_uuids, visible_order_uuids, outcome) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", c.environmentId(), c.runId(), tranche.trancheId(),
                tranche.windowId(), tranche.supplyId(), tick.tickId(), now, config.policyVersion(), snap.source(),
                digest, added, out.get("visibleOrderUuids"), out);
        tx.emit("stock-released:" + tranche.trancheId(), "stock-released", out);
        return complete(tx, tick, tickVersion, out);
    }

    /** Marks the tick completed with its outcome; the work result is the tick's stored envelope. */
    private static WorkResult complete(Tx tx, TickRow tick, long version, JsonNode outcome) throws SQLException {
        RunContext c = tx.context();
        ObjectNode env = okEnvelope(outcome);
        tx.cas("UPDATE supply_release_ticks SET state = 'completed', last_outcome = ?, version = version + 1, "
                + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND tick_id = ? AND version = ? "
                + "AND state = 'pending'", env, c.environmentId(), c.runId(), tick.tickId(), version);
        return WorkResult.ok(env);
    }

    private static Map<String, Known> knownCars(Tx tx, List<ObjectNode> stock) throws SQLException {
        Map<String, Known> known = new HashMap<>();
        if (stock.isEmpty()) return known;
        RunContext c = tx.context();
        String[] uuids = stock.stream().map(car -> car.get("orderUuid").asText()).toArray(String[]::new);
        try (PreparedStatement ps = tx.connection().prepareStatement("SELECT order_uuid, configuration_id, state, "
                + "version, attributes::text FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ANY(?)")) {
            ps.setString(1, c.environmentId());
            ps.setString(2, c.runId());
            ps.setArray(3, tx.connection().createArrayOf("text", uuids));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    known.put(rs.getString(1), new Known(rs.getString(2), rs.getString(3), rs.getLong(4),
                            ReleasedStock.json(rs.getString(5))));
                }
            }
        }
        return known;
    }

    /** Known unreleased cars that an occupying custody hold covers. */
    private static Set<String> occupied(Tx tx, Map<String, Known> known) throws SQLException {
        Set<String> held = new HashSet<>();
        String[] uuids = known.entrySet().stream().filter(e -> "unreleased".equals(e.getValue().state()))
                .map(Map.Entry::getKey).toArray(String[]::new);
        if (uuids.length == 0) return held;
        RunContext c = tx.context();
        try (PreparedStatement ps = tx.connection().prepareStatement("SELECT order_uuid FROM custody_holds "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ANY(?) AND state IN " + OCCUPYING)) {
            ps.setString(1, c.environmentId());
            ps.setString(2, c.runId());
            ps.setArray(3, tx.connection().createArrayOf("text", uuids));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) held.add(rs.getString(1));
            }
        }
        return held;
    }

    private static boolean identityMatches(Known k, ObjectNode car) {
        if (!k.configurationId().equals(car.get("configurationId").asText())) return false;
        for (String key : List.of("orderNumber", "wholesalerOrderId", "corpusVersion", "revision")) {
            if (!same(k.attributes().get(key), car.get(key))) return false;
        }
        return true;
    }

    private static boolean same(JsonNode a, JsonNode b) {
        if (a == null || b == null) return a == b;
        if (a.isIntegralNumber() && b.isIntegralNumber()) return a.asLong() == b.asLong();
        return a.equals(b);
    }

    // ---- confirmed supply ----

    /** Queues provider-confirmed supply for release after the policy lead time. Callers check the role. */
    public ReleaseResult queueConfirmedSupply(RunContext scope, String commandId, Instant now, SupplyConfirmation c) {
        if (commandId == null || commandId.isEmpty() || now == null || c == null || c.confirmedAt() == null
                || !"confirmed".equals(c.state()) || c.supplyId() == null || c.supplyId().isEmpty()
                || c.supplyId().length() > 512 || c.sourceVersion() == null || c.sourceVersion().isEmpty()
                || c.sourceVersion().length() > 512) {
            return ReleaseResult.invalid(null, "invalid-confirmed-supply",
                    "Supply a run-bound provider confirmation reference, without stock rows.");
        }
        Instant confirmedAt = c.confirmedAt().truncatedTo(ChronoUnit.MILLIS);
        if (confirmedAt.isAfter(now)) {
            return ReleaseResult.invalid(null, "invalid-confirmed-supply", "A future confirmation is not confirmed supply.");
        }
        PolicyReading reading;
        try {
            reading = policy.read(scope.runId(), now);
        } catch (RuntimeException e) {
            reading = new PolicyReading.Unavailable("The release policy could not be read.");
        }
        if (reading instanceof PolicyReading.Unavailable u) {
            return ReleaseResult.unavailable(null, "policy-unavailable", u.reason());
        }
        PolicyReading.Ok config = (PolicyReading.Ok) reading;
        ObjectNode input = JSON.createObjectNode();
        input.put("supplyId", c.supplyId());
        input.put("state", "confirmed");
        input.put("confirmedAt", Iso.format(confirmedAt));
        input.put("sourceVersion", c.sourceVersion());
        String digest = Canonical.digest(input);
        Instant eligible = confirmedAt.plus(config.leadTimeDays(), ChronoUnit.DAYS);
        RunContext ctx = actor(scope);
        Work work = tx -> queue(tx, input, digest, eligible, config.policyVersion());
        Outcome o = runner.execute(ctx, new Command("supply.queue", "queue:" + commandId, input), work);
        if (o instanceof Outcome.Conflict k && "duplicate-record".equals(k.code())) {
            o = runner.execute(ctx, new Command("supply.queue", "queue:" + commandId, input), work);
        }
        if (o instanceof Outcome.Committed ok) return ReleaseResult.ok(null, ok.result(), ok.replayed());
        if (o instanceof Outcome.Uncertain) return ReleaseResult.uncertain(null);
        if (o instanceof Outcome.Conflict k) {
            String code = "command-input-changed".equals(k.code()) ? "confirmation-input-changed" : k.code();
            return ReleaseResult.conflict(null, code, k.message(), k.retryable());
        }
        if (o instanceof Outcome.Refused r) return ReleaseResult.invalid(null, r.code(), r.message());
        return databaseDown(null);
    }

    private static WorkResult queue(Tx tx, ObjectNode input, String digest, Instant eligible, String policyVersion)
            throws SQLException {
        RunContext c = tx.context();
        Optional<Object[]> prior = tx.first("SELECT input_digest, eligible_from, policy_version "
                + "FROM confirmed_supply_queue WHERE environment_id = ? AND run_id = ? AND supply_id = ?",
                rs -> new Object[] {rs.getString(1), rs.getObject(2, OffsetDateTime.class).toInstant(), rs.getString(3)},
                c.environmentId(), c.runId(), input.get("supplyId").asText());
        ObjectNode out = input.deepCopy();
        if (prior.isPresent()) {
            if (!digest.equals(prior.get()[0])) {
                throw new TxConflict("confirmation-input-changed", "The supply id was confirmed with different input.");
            }
            out.put("eligibleFrom", Iso.format((Instant) prior.get()[1]));
            out.put("policyVersion", (String) prior.get()[2]);
            return WorkResult.ok(out);
        }
        out.put("eligibleFrom", Iso.format(eligible));
        out.put("policyVersion", policyVersion);
        tx.write("INSERT INTO confirmed_supply_queue (environment_id, run_id, supply_id, confirmed_at, "
                + "source_version, eligible_from, policy_version, input_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                c.environmentId(), c.runId(), input.get("supplyId").asText(),
                Iso.parse(input.get("confirmedAt").asText()), input.get("sourceVersion").asText(), eligible,
                policyVersion, digest);
        return WorkResult.ok(out);
    }
}
