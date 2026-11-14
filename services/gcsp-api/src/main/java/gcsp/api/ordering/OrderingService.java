package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.ordering.OrderingProjection.Row;
import gcsp.api.ordering.OrderingProviderPort.ProviderRequest;
import gcsp.api.ordering.OrderingProviderPort.ProviderResponse;
import gcsp.api.ordering.OrderingProviderPort.Status;
import gcsp.api.ordering.OrderingTerms.Failed;
import gcsp.api.ordering.OrderingTerms.ReferenceFormat;
import gcsp.api.ordering.OrderingTerms.ReferenceOk;
import gcsp.api.ordering.OrderingTerms.TermsOk;
import gcsp.api.ordering.SelectionConversionPort.Converted;
import gcsp.api.ordering.SelectionConversionPort.Refusal;
import gcsp.api.ordering.SelectionConversionPort.SourceInput;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.PendingOperations;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Supplier;
import javax.sql.DataSource;

/**
 * The one ordering operation: current versions, terms and the exact selection authorise exactly one handoff.
 * Intent is durable before the provider is called; a repeat, a lost answer or a restart reconciles, never resubmits.
 */
public final class OrderingService {

    static final String TYPE = "selection-order";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> TOP_KEYS = Set.of("commandId", "source", "expectedQuoteId", "expectedStockVersion",
            "termsDigest", "declarations");
    private static final Set<String> SOURCE_KEYS = Set.of("type", "holdId", "expectedHoldVersion", "expectedDraftVersion");
    private static final String SELECT_ROW = "SELECT s.operation_id, s.employee_id, s.entitlement_slot_id, s.source_type, "
            + "s.hold_id, s.order_uuid, s.order_reference, s.policy_version, s.selection::text, s.handoff_lease_until, "
            + "p.state, p.version, p.attempts, p.provider_reference, p.outcome::text, p.input_digest "
            + "FROM selection_orders s JOIN pending_operations p ON p.environment_id = s.environment_id "
            + "AND p.run_id = s.run_id AND p.operation_id = s.operation_id ";

    private record Input(String commandId, SourceInput source, String quoteId, long stockVersion, String termsDigest,
            JsonNode declarations, ObjectNode intent) {}

    /** A database failure inside a helper; the public methods answer it as unavailable. */
    private static final class Db extends RuntimeException {
        Db(SQLException cause) {
            super(cause);
        }
    }

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final OrderingTerms terms;
    private final OrderingProviderPort provider;
    private final Duration lease;
    private final Supplier<Instant> wall;

    public OrderingService(DataSource dataSource, OrderingTerms terms, OrderingProviderPort provider) {
        this(dataSource, terms, provider, Duration.ofSeconds(30), Instant::now);
    }

    public OrderingService(DataSource dataSource, OrderingTerms terms, OrderingProviderPort provider, Duration lease,
            Supplier<Instant> wall) {
        this.dataSource = dataSource;
        this.runner = new TransactionRunner(dataSource);
        this.terms = terms;
        this.provider = provider;
        this.lease = lease;
        this.wall = wall;
    }

    public static String operationId(OrderingScope scope) {
        ObjectNode ids = JSON.createObjectNode();
        ids.putArray("ids").add(scope.runId()).add(scope.employeeId()).add(scope.entitlementSlotId());
        return "selection:" + Canonical.digest(ids.get("ids"));
    }

    // ---- terms ----

    public OrderingResult terms(OrderingScope scope) {
        try {
            return switch (terms.terms(scope, terms.now(scope))) {
                case TermsOk ok -> new OrderingResult.Ok(ok.value(), false);
                case Failed f -> new OrderingResult.Unavailable(f.code());
            };
        } catch (RuntimeException e) {
            return new OrderingResult.Unavailable("ordering-policy-unavailable");
        }
    }

    // ---- submit ----

    /** The employee route: only the cart converter, never a Buddy offer. */
    public OrderingResult submit(OrderingScope scope, JsonNode input, SelectionConversionPort converter) {
        if (converter == null || !"cart".equals(converter.sourceType())) {
            return new OrderingResult.Unavailable(UnconfiguredConversion.CODE);
        }
        return guarded(scope, input, converter);
    }

    /** Trusted composition only (a Buddy offer decision), never routed to HTTP: the caller has authenticated the offer. */
    public OrderingResult submitTrusted(OrderingScope scope, JsonNode input, SelectionConversionPort converter) {
        if (converter == null || !"buddy-offer".equals(converter.sourceType())) {
            return new OrderingResult.Unavailable(UnconfiguredConversion.CODE);
        }
        return guarded(scope, input, converter);
    }

    private OrderingResult guarded(OrderingScope scope, JsonNode input, SelectionConversionPort converter) {
        try {
            return doSubmit(scope, input, converter);
        } catch (Db e) {
            return new OrderingResult.Unavailable("database-unavailable");
        }
    }

    private OrderingResult doSubmit(OrderingScope scope, JsonNode raw, SelectionConversionPort converter) {
        if ("none".equals(provider.mode())) return new OrderingResult.Unavailable("ordering-provider-not-configured");
        Input input = parse(raw);
        if (input == null) return invalid("selection");
        if (converter == null || !converter.sourceType().equals(input.source().type())) return invalid("source");
        String id = operationId(scope);
        String digest = Canonical.digest(input.intent());
        OrderingResult existing = existing(scope, id, digest);
        if (existing != null) return replayed(existing);

        Instant now = terms.now(scope);
        OrderingTerms.TermsRead tr = terms.terms(scope, now);
        if (tr instanceof Failed f) return new OrderingResult.Unavailable(f.code());
        ObjectNode termsValue = ((TermsOk) tr).value();
        if (!input.termsDigest().equals(termsValue.path("termsDigest").asText())) return refused("terms-changed");
        OrderingTerms.ReferenceRead rr = terms.reference(scope, now);
        if (rr instanceof Failed f) return new OrderingResult.Unavailable(f.code());
        ReferenceFormat format = ((ReferenceOk) rr).format();

        SelectionConversionPort.Preparation prep = converter.prepare(scope, input.source());
        if (prep instanceof Refusal r) return refusal(r.code());
        SelectionConversionPort.Prepared prepared = (SelectionConversionPort.Prepared) prep;
        if (!"new".equals(prepared.mode()) && !"replacement".equals(prepared.mode())) return invalid("draft");
        if (!declarationsOk(termsValue.get("declarations"), prepared.mode(), input.declarations())) return invalid("declarations");

        Outcome o = runner.execute(scope.context(), new Command("ordering.submit", "ordering:submit:" + id, input.intent()),
                tx -> submitWork(tx, scope, id, digest, input, converter, prepared, termsValue, format, now));
        if (o instanceof Outcome.Committed c) {
            OrderingResult driven = drive(scope, id);
            return c.changed() ? driven : replayed(driven);
        }
        if (o instanceof Outcome.Uncertain) return new OrderingResult.Pending(id, null);
        if (o instanceof Outcome.Unavailable) return new OrderingResult.Unavailable("database-unavailable");
        // A refusal or conflict may only mean a concurrent identical submit won: the stored intent decides.
        OrderingResult won = existing(scope, id, digest);
        if (won != null) return replayed(won);
        if (o instanceof Outcome.Refused r) return refusal(r.code());
        return refused(((Outcome.Conflict) o).code());
    }

    private WorkResult submitWork(Tx tx, OrderingScope scope, String id, String digest, Input input,
            SelectionConversionPort converter, SelectionConversionPort.Prepared prepared, ObjectNode termsValue,
            ReferenceFormat format, Instant now) throws Exception {
        RunContext c = tx.context();
        Optional<String> prior = tx.first("SELECT input_digest FROM pending_operations WHERE environment_id = ? "
                + "AND run_id = ? AND operation_id = ?", rs -> rs.getString(1), c.environmentId(), c.runId(), id);
        if (prior.isPresent()) {
            return prior.get().equals(digest) ? WorkResult.ok(JSON.createObjectNode().put("operationId", id))
                    : WorkResult.refuse("active-selection-exists", "A different selection already exists");
        }
        SelectionConversionPort.Conversion cv = converter.convert(tx, scope, new SelectionConversionPort.ConversionRequest(
                input.source().holdId(), input.source().expectedHoldVersion(), input.source().expectedDraftVersion(),
                input.quoteId(), input.stockVersion(), id, now));
        if (cv instanceof Refusal r) return WorkResult.refuse(r.code(), r.code());
        Converted conv = (Converted) cv;
        if (conv.orderUuid() == null || conv.orderUuid().isBlank() || conv.orderNumber() == null
                || !conv.orderNumber().matches("\\d{7}") || conv.configurationId() == null || conv.configurationId().isBlank()
                || conv.quote() == null || !input.quoteId().equals(conv.quote().path("quoteId").asText(null))) {
            return WorkResult.refuse("selection-conversion-invalid", "The converted selection is not usable");
        }
        long number = tx.first("INSERT INTO ordering_reference_counters (environment_id, run_id, prefix, next_value) "
                + "VALUES (?, ?, ?, ?) ON CONFLICT (environment_id, run_id, prefix) DO UPDATE SET "
                + "next_value = GREATEST(ordering_reference_counters.next_value, ?) + 1 RETURNING next_value - 1",
                rs -> rs.getLong(1), c.environmentId(), c.runId(), format.prefix(), format.first() + 1, format.first()).orElseThrow();
        String digits = Long.toString(number);
        if (digits.length() > format.digits()) return WorkResult.refuse("order-reference-exhausted", "No order references remain");
        String reference = format.prefix() + "0".repeat(format.digits() - digits.length()) + digits;

        ObjectNode sel = JSON.createObjectNode();
        sel.put("schemaVersion", 1);
        sel.put("orderReference", reference);
        sel.put("receivedAt", PolicyClock.iso(now));
        if (conv.renewalId() == null) sel.putNull("renewalId");
        else sel.put("renewalId", conv.renewalId());
        sel.putObject("source").put("type", input.source().type()).put("holdId", input.source().holdId())
                .put("expectedHoldVersion", input.source().expectedHoldVersion())
                .put("expectedDraftVersion", input.source().expectedDraftVersion());
        sel.set("quote", conv.quote());
        ObjectNode stock = sel.putObject("stock");
        stock.put("orderUuid", conv.orderUuid()).put("orderNumber", conv.orderNumber())
                .put("configurationId", conv.configurationId());
        stock.set("facts", conv.stockFacts() == null ? JSON.createObjectNode() : conv.stockFacts());
        sel.set("terms", termsValue);
        sel.set("declarations", input.declarations());
        sel.putObject("draft").put("mode", prepared.mode());
        sel.set("driver", orNull(prepared.driver()));
        sel.set("contact", orNull(prepared.contact()));
        sel.set("employee", orNull(prepared.employee()));
        sel.set("sourceVersions", orNull(prepared.sourceVersions()));

        PendingOperations.recordIntent(tx, id, TYPE, id, input.intent());
        tx.write("INSERT INTO selection_orders (environment_id, run_id, operation_id, employee_id, entitlement_slot_id, "
                + "source_type, hold_id, order_uuid, order_reference, policy_version, selection, received_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", c.environmentId(), c.runId(), id, scope.employeeId(),
                scope.entitlementSlotId(), input.source().type(), input.source().holdId(), conv.orderUuid(), reference,
                scope.policyVersion(), sel, now);
        ObjectNode event = JSON.createObjectNode();
        event.put("operationId", id).put("employeeId", scope.employeeId()).put("entitlementSlotId", scope.entitlementSlotId())
                .put("orderUuid", conv.orderUuid()).put("orderReference", reference)
                .put("sourceType", input.source().type()).put("receivedAt", PolicyClock.iso(now));
        tx.emit(id + ":received", "ordering.selection-received", event);
        return WorkResult.ok(JSON.createObjectNode().put("operationId", id));
    }

    // ---- read, drive, reconcile ----

    public OrderingResult read(OrderingScope scope) {
        try {
            Row r = load(scope.environmentId(), scope.runId(), operationId(scope));
            if (r == null) return new OrderingResult.Refused("not-found", 404, null);
            return r.employeeId().equals(scope.employeeId()) ? result(r) : new OrderingResult.Refused("forbidden", 403, null);
        } catch (Db e) {
            return new OrderingResult.Unavailable("database-unavailable");
        }
    }

    public OrderingResult reconcile(OrderingScope scope, String operationId) {
        return drive(scope, operationId);
    }

    /** Drives up to limit (1..100) open handoffs whose lease is free: startup and the presenter use this. */
    public OrderingResult reconcileOpen(RunContext ctx, int limit) {
        if (limit < 1 || limit > 100) return invalid("limit");
        if ("none".equals(provider.mode())) return new OrderingResult.Unavailable("ordering-provider-not-configured");
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT s.operation_id, "
                + "s.employee_id, s.entitlement_slot_id, s.policy_version FROM selection_orders s JOIN pending_operations p "
                + "ON p.environment_id = s.environment_id AND p.run_id = s.run_id AND p.operation_id = s.operation_id "
                + "WHERE s.environment_id = ? AND s.run_id = ? AND p.state IN ('intent', 'pending') "
                + "AND (s.handoff_lease_until IS NULL OR s.handoff_lease_until <= ?) ORDER BY p.updated_at, s.operation_id LIMIT ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setObject(3, wall.get().atOffset(java.time.ZoneOffset.UTC));
            ps.setInt(4, limit);
            List<OrderingScope> scopes = new ArrayList<>();
            List<String> ids = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    ids.add(rs.getString(1));
                    scopes.add(new OrderingScope(ctx.environmentId(), ctx.runId(), rs.getString(2), rs.getString(3), rs.getString(4)));
                }
            }
            int settled = 0;
            for (int i = 0; i < ids.size(); i++) {
                if (drive(scopes.get(i), ids.get(i)) instanceof OrderingResult.Ok) settled++;
            }
            return new OrderingResult.Ok(JSON.createObjectNode().put("examined", ids.size()).put("settled", settled)
                    .put("stillPending", ids.size() - settled), false);
        } catch (SQLException e) {
            return new OrderingResult.Unavailable("database-unavailable");
        }
    }

    public OrderingResult drive(OrderingScope scope, String id) {
        try {
            return doDrive(scope, id);
        } catch (Db e) {
            return new OrderingResult.Unavailable("database-unavailable");
        }
    }

    private OrderingResult doDrive(OrderingScope scope, String id) {
        Row r = load(scope.environmentId(), scope.runId(), id);
        if (r == null) return new OrderingResult.Refused("not-found", 404, null);
        if (!r.employeeId().equals(scope.employeeId())) return new OrderingResult.Refused("forbidden", 403, null);
        if (!r.open() || "none".equals(provider.mode())) return result(r);

        // Claim: one driver at a time holds the lease and the version, so one provider call is in flight.
        Instant now = wall.get();
        long version = r.version();
        Outcome claim = runner.execute(scope.context(), new Command("ordering.claim", "ordering:claim:" + id + ":" + version,
                JSON.createObjectNode().put("operationId", id).put("version", version)),
                tx -> claimWork(tx, id, version, now));
        if (!(claim instanceof Outcome.Committed c) || c.replayed()) return current(scope, id);
        long claimed = version + 1;

        JsonNode snap = r.selection();
        JsonNode stages = snap.path("terms").path("approvalStages");
        ProviderRequest req = new ProviderRequest(id, id, r.inputDigest(), r.orderUuid(),
                snap.path("stock").path("orderNumber").asText(), snap.path("stock").path("configurationId").asText(),
                stages.path(0).asText());
        ProviderResponse resp = null;
        try {
            resp = provider.reconcile(scope, req);
            if (resp != null && resp.status() == Status.NOT_FOUND && matches(resp, scope, req)) resp = provider.execute(scope, req);
        } catch (RuntimeException e) {
            resp = null;
        }
        boolean confirmed = resp != null && confirmed(resp, scope, req);
        boolean rejected = resp != null && !confirmed && (resp.status() == Status.REJECTED || resp.status() == Status.UNSUPPORTED)
                && matches(resp, scope, req);
        ObjectNode outcome = JSON.createObjectNode();
        if (confirmed) {
            outcome.put("status", "confirmed").put("operationId", id).put("runId", scope.runId())
                    .put("orderUuid", req.orderUuid()).put("orderNumber", resp.orderNumber())
                    .put("configurationId", resp.configurationId()).put("orderStatus", resp.orderStatus())
                    .put("providerReference", resp.providerReference()).put("fictional", resp.fictional());
        } else if (rejected) {
            outcome.put("status", "rejected").put("operationId", id).put("reason", reason(resp.reason(), "ordering-refused"));
        } else {
            outcome.put("status", "unknown").put("reason", resp == null ? "provider-unreachable"
                    : reason(resp.reason(), resp.status().name().toLowerCase(java.util.Locale.ROOT)));
        }
        Outcome fin = runner.execute(scope.context(), new Command("ordering.finish", "ordering:finish:" + id + ":" + claimed,
                outcome), tx -> finishWork(tx, scope, r, claimed, confirmed ? "acknowledged" : rejected ? "refused" : "pending",
                        outcome, now));
        if (fin instanceof Outcome.Uncertain) return new OrderingResult.Pending(id, null);
        return current(scope, id);
    }

    private WorkResult claimWork(Tx tx, String id, long expected, Instant now) throws SQLException {
        RunContext c = tx.context();
        Optional<Object[]> locked = tx.first("SELECT p.state, p.version, s.handoff_lease_until FROM selection_orders s "
                + "JOIN pending_operations p ON p.environment_id = s.environment_id AND p.run_id = s.run_id "
                + "AND p.operation_id = s.operation_id WHERE s.environment_id = ? AND s.run_id = ? AND s.operation_id = ? "
                + "FOR UPDATE OF s, p", rs -> new Object[] {rs.getString(1), rs.getLong(2), instant(rs, 3)},
                c.environmentId(), c.runId(), id);
        if (locked.isEmpty()) return WorkResult.refuse("not-found", "No such selection");
        Object[] l = locked.get();
        if (!"intent".equals(l[0]) && !"pending".equals(l[0])) return WorkResult.refuse("handoff-settled", "Already settled");
        if ((long) l[1] != expected) throw new TxConflict("stale-version", "The selection changed since it was read");
        if (l[2] != null && ((Instant) l[2]).isAfter(now)) return WorkResult.refuse("handoff-in-progress", "A handoff is running");
        tx.write("UPDATE selection_orders SET handoff_lease_until = ?, updated_at = now() WHERE environment_id = ? "
                + "AND run_id = ? AND operation_id = ?", now.plus(lease), c.environmentId(), c.runId(), id);
        PendingOperations.markPending(tx, id, expected, JSON.createObjectNode().put("phase", "submitting"));
        return WorkResult.ok(JSON.createObjectNode().put("claimedVersion", expected + 1));
    }

    private WorkResult finishWork(Tx tx, OrderingScope scope, Row r, long claimed, String state, ObjectNode outcome,
            Instant now) throws SQLException {
        RunContext c = tx.context();
        String reference = "acknowledged".equals(state) ? outcome.path("providerReference").asText() : null;
        PendingOperations.finalize(tx, r.operationId(), claimed, state, reference, outcome);
        tx.write("UPDATE selection_orders SET handoff_lease_until = NULL, updated_at = now() WHERE environment_id = ? "
                + "AND run_id = ? AND operation_id = ?", c.environmentId(), c.runId(), r.operationId());
        if (!"pending".equals(state)) {
            ObjectNode e = JSON.createObjectNode();
            e.put("operationId", r.operationId()).put("employeeId", r.employeeId()).put("entitlementSlotId", r.slotId())
                    .put("orderUuid", r.orderUuid()).put("orderReference", r.orderReference())
                    .put("occurredAt", PolicyClock.iso(now));
            if ("acknowledged".equals(state)) {
                JsonNode renewal = r.selection().path("renewalId");
                if (renewal.isTextual()) e.put("renewalId", renewal.asText());
                e.put("providerReference", reference);
            } else {
                e.put("reason", outcome.path("reason").asText());
            }
            tx.emit(r.operationId() + ":outcome", "acknowledged".equals(state) ? "ordering.selection-acknowledged"
                    : "ordering.selection-refused", e);
        }
        return WorkResult.ok(JSON.createObjectNode().put("state", state));
    }

    // ---- helpers ----

    private static boolean matches(ProviderResponse r, OrderingScope scope, ProviderRequest q) {
        return q.operationId().equals(r.operationId()) && scope.runId().equals(r.runId()) && q.orderUuid().equals(r.orderUuid());
    }

    private static boolean confirmed(ProviderResponse r, OrderingScope scope, ProviderRequest q) {
        return r.status() == Status.CONFIRMED && matches(r, scope, q) && q.orderNumber().equals(r.orderNumber())
                && q.configurationId().equals(r.configurationId()) && q.firstApprovalStage().equals(r.orderStatus())
                && r.providerReference() != null && !r.providerReference().isBlank();
    }

    private static String reason(String given, String fallback) {
        return given == null || given.isBlank() ? fallback : given;
    }

    private static JsonNode orNull(JsonNode n) {
        return n == null ? JSON.nullNode() : n;
    }

    private OrderingResult existing(OrderingScope scope, String id, String digest) {
        Row r = load(scope.environmentId(), scope.runId(), id);
        if (r == null) return null;
        if (!r.employeeId().equals(scope.employeeId())) return new OrderingResult.Refused("forbidden", 403, null);
        return r.inputDigest().equals(digest) ? drive(scope, id) : refused("active-selection-exists");
    }

    private OrderingResult current(OrderingScope scope, String id) {
        Row r = load(scope.environmentId(), scope.runId(), id);
        return r == null ? new OrderingResult.Refused("not-found", 404, null) : result(r);
    }

    private static OrderingResult result(Row r) {
        JsonNode v = OrderingProjection.of(r);
        return r.open() ? new OrderingResult.Pending(r.operationId(), v) : new OrderingResult.Ok(v, false);
    }

    private static OrderingResult replayed(OrderingResult r) {
        return r instanceof OrderingResult.Ok ok ? new OrderingResult.Ok(ok.value(), true) : r;
    }

    private static OrderingResult invalid(String field) {
        return new OrderingResult.Refused("invalid", 400, field);
    }

    private static OrderingResult refused(String code) {
        return new OrderingResult.Refused(code, 409, null);
    }

    private static OrderingResult refusal(String code) {
        return switch (code) {
            case "forbidden" -> new OrderingResult.Refused(code, 403, null);
            case "not-found" -> new OrderingResult.Refused(code, 404, null);
            case "invalid" -> invalid("selection");
            case UnconfiguredConversion.CODE, "order-reference-exhausted" -> new OrderingResult.Unavailable(code);
            default -> refused(code);
        };
    }

    private static boolean declarationsOk(JsonNode required, String mode, JsonNode given) {
        Set<String> ids = new HashSet<>();
        for (JsonNode d : required) {
            String applies = d.path("appliesTo").asText();
            if ("all".equals(applies) || mode.equals(applies)) ids.add(d.path("id").asText());
        }
        Set<String> names = new HashSet<>();
        given.fieldNames().forEachRemaining(names::add);
        if (!names.equals(ids)) return false;
        for (String n : names) if (!given.get(n).isBoolean() || !given.get(n).booleanValue()) return false;
        return true;
    }

    private static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.asText().isBlank() && n.asText().length() <= 128;
    }

    private static boolean positive(JsonNode n) {
        return n != null && n.isIntegralNumber() && n.canConvertToLong() && n.asLong() > 0;
    }

    private static boolean only(JsonNode n, Set<String> keys) {
        if (n == null || !n.isObject()) return false;
        for (var it = n.fieldNames(); it.hasNext();) if (!keys.contains(it.next())) return false;
        return true;
    }

    private static Input parse(JsonNode raw) {
        if (!only(raw, TOP_KEYS)) return null;
        JsonNode s = raw.get("source");
        if (!text(raw.get("commandId")) || !text(raw.get("expectedQuoteId")) || !text(raw.get("termsDigest"))
                || !positive(raw.get("expectedStockVersion")) || !only(s, SOURCE_KEYS)
                || !List.of("cart", "buddy-offer").contains(s.path("type").asText()) || !text(s.get("holdId"))
                || !positive(s.get("expectedHoldVersion")) || !positive(s.get("expectedDraftVersion"))
                || raw.get("declarations") == null || !raw.get("declarations").isObject()) {
            return null;
        }
        ObjectNode intent = ((ObjectNode) raw).deepCopy();
        intent.remove("commandId");
        return new Input(raw.get("commandId").asText(), new SourceInput(s.get("type").asText(), s.get("holdId").asText(),
                s.get("expectedHoldVersion").asLong(), s.get("expectedDraftVersion").asLong()), raw.get("expectedQuoteId").asText(),
                raw.get("expectedStockVersion").asLong(), raw.get("termsDigest").asText(), raw.get("declarations"), intent);
    }

    private static Instant instant(ResultSet rs, int col) throws SQLException {
        OffsetDateTime t = rs.getObject(col, OffsetDateTime.class);
        return t == null ? null : t.toInstant();
    }

    private Row load(String environmentId, String runId, String operationId) {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(
                SELECT_ROW + "WHERE s.environment_id = ? AND s.run_id = ? AND s.operation_id = ?")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setString(3, operationId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        } catch (SQLException e) {
            throw new Db(e);
        }
    }

    static Row map(ResultSet rs) throws SQLException {
        try {
            String outcome = rs.getString(15);
            return new Row(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                    rs.getString(6), rs.getString(7), rs.getString(8), JSON.readTree(rs.getString(9)), instant(rs, 10),
                    rs.getString(11), rs.getLong(12), rs.getInt(13), rs.getString(14),
                    outcome == null ? null : JSON.readTree(outcome), rs.getString(16));
        } catch (java.io.IOException e) {
            throw new SQLException("Stored selection is unreadable");
        }
    }

    static String selectRow() {
        return SELECT_ROW;
    }
}
