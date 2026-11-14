package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.appointments.AppointmentStore.Edit;
import gcsp.api.appointments.AppointmentStore.Op;
import gcsp.api.appointments.AppointmentStore.Probe;
import gcsp.api.appointments.AppointmentStore.Row;
import gcsp.api.auth.Access;
import gcsp.api.auth.IdentityRefusal;
import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.PendingOperations;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.WorkResult;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;

/** Handover appointment planning: read, request, accept a change and the presenter tick (one command per write). */
public final class AppointmentService implements AutoCloseable {

    public static final String SYSTEM_ACTOR = "lifecycle-appointments";
    static final String INVALID = "invalid-appointment-command";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String NOT_SENT = "Your order has not been sent to ordering yet.";
    private static final String NOT_OPEN = "Appointments are not available for this order yet.";
    private static final String OFFER_DOWN = "Slots are unavailable. Try again shortly.";
    private static final String DOWN = "Appointments are unavailable. Try again shortly.";
    private static final Set<String> REQUEST_KEYS = Set.of("commandId", "orderUuid", "slotId", "expectedVersion");
    private static final Set<String> ACCEPT_KEYS = Set.of("commandId", "orderUuid", "proposalId", "expectedVersion");

    private final DataSource dataSource;
    private final AppointmentPolicy policy;
    private final AppointmentProvider provider;
    private final OrderStagePort stages;
    private final AppointmentClock clock;
    private final TransactionRunner runner;
    private final ProviderCalls calls = new ProviderCalls();

    public AppointmentService(DataSource dataSource, AppointmentPolicy policy, AppointmentProvider provider,
            OrderStagePort stages, AppointmentClock clock) {
        this.dataSource = dataSource;
        this.policy = policy;
        this.provider = provider;
        this.stages = stages;
        this.clock = clock;
        this.runner = new TransactionRunner(dataSource);
    }

    @Override
    public void close() {
        calls.close();
    }

    // ---- reads and commands ----

    /** Employee (own order only), greg or presenter. Input {orderUuid}. */
    public AppointmentResult read(Principal who, RunContext run, JsonNode input) {
        return safe(() -> {
            AppointmentResult denied = role(who, Role.EMPLOYEE, Role.GREG, Role.PRESENTER);
            if (denied != null) return denied;
            List<AppointmentResult.Reason> bad = fields(input, Set.of("orderUuid"));
            if (!Values.id(input == null ? null : input.get("orderUuid"), 128)) bad.add(reason("orderUuid", "Choose an order to view."));
            if (!bad.isEmpty()) return new AppointmentResult.Invalid(INVALID, bad);
            Prep prep = prepare(who, run);
            if (prep.error != null) return prep.error;
            return readModel(who, run, prep, input.get("orderUuid").asText());
        });
    }

    /** Employee only, own order. Input {commandId, orderUuid, slotId, expectedVersion}. */
    public AppointmentResult request(Principal who, RunContext run, JsonNode input) {
        return safe(() -> {
            AppointmentResult denied = role(who, Role.EMPLOYEE);
            if (denied != null) return denied;
            List<AppointmentResult.Reason> bad = fields(input, REQUEST_KEYS);
            commandFields(input, bad);
            if (!Values.id(input == null ? null : input.get("orderUuid"), 128)) bad.add(reason("orderUuid", "Choose an order."));
            if (!Values.id(input == null ? null : input.get("slotId"), 64)) bad.add(reason("slotId", "Choose one of the offered slots."));
            if (!bad.isEmpty()) return new AppointmentResult.Invalid(INVALID, bad);
            Prep prep = prepare(who, run);
            if (prep.error != null) return prep.error;
            return doRequest(who, run, prep, input);
        });
    }

    /** Employee only, own appointment. Input {commandId, orderUuid, proposalId, expectedVersion}. */
    public AppointmentResult acceptChange(Principal who, RunContext run, JsonNode input) {
        return safe(() -> {
            AppointmentResult denied = role(who, Role.EMPLOYEE);
            if (denied != null) return denied;
            List<AppointmentResult.Reason> bad = fields(input, ACCEPT_KEYS);
            commandFields(input, bad);
            if (!Values.id(input == null ? null : input.get("orderUuid"), 128)) bad.add(reason("orderUuid", "Choose an order."));
            if (!Values.id(input == null ? null : input.get("proposalId"), 128)) {
                bad.add(reason("proposalId", "Supply the proposed change to accept."));
            }
            if (!bad.isEmpty()) return new AppointmentResult.Invalid(INVALID, bad);
            Prep prep = prepare(who, run);
            if (prep.error != null) return prep.error;
            return doAccept(who, run, prep, input);
        });
    }

    // ---- presenter ticks ----

    /** Records the presenter's tick as the run's appointment time: never backwards, the same id and time replays. */
    public AppointmentResult recordTick(Principal who, RunContext run, String tickId, Instant now) {
        return safe(() -> {
            AppointmentResult denied = role(who, Role.PRESENTER);
            if (denied != null) return denied;
            List<AppointmentResult.Reason> bad = new ArrayList<>();
            if (!Values.id(tickId, 200)) bad.add(reason("tickId", "Supply a tick id."));
            if (now == null) bad.add(reason("now", "Supply the tick time."));
            if (!bad.isEmpty()) return new AppointmentResult.Invalid(INVALID, bad);
            RunContext ctx = system(run);
            Instant at = now.truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
            ObjectNode input = JSON.createObjectNode().put("tickId", tickId).put("now", Iso.format(at));
            Outcome o = runner.execute(ctx, new Command("appointment.tick.record", "tick:" + tickId, input), tx -> {
                Optional<Instant> latest = tx.first("SELECT tick_now FROM appointment_ticks WHERE environment_id = ? "
                        + "AND run_id = ? ORDER BY tick_now DESC, seq DESC LIMIT 1",
                        rs -> rs.getObject(1, java.time.OffsetDateTime.class).toInstant(), ctx.environmentId(), ctx.runId());
                if (latest.isPresent() && latest.get().isAfter(at)) {
                    throw new TxConflict("clock-backwards", "The tick is earlier than the run's latest tick.");
                }
                tx.write("INSERT INTO appointment_ticks (environment_id, run_id, tick_id, tick_now, input_digest) "
                        + "VALUES (?, ?, ?, ?, ?)", ctx.environmentId(), ctx.runId(), tickId, at, Canonical.digest(input));
                return WorkResult.ok(JSON.createObjectNode().put("tickId", tickId).put("now", Iso.format(at)));
            });
            return mapped(o);
        });
    }

    /** Progresses every actionable appointment at the tick's time and returns the summary. */
    public AppointmentResult tick(Principal who, RunContext run, Instant now) {
        AppointmentResult denied = role(who, Role.PRESENTER);
        return denied != null ? denied : sweep(run, now, false);
    }

    /** Startup: only reconciles open provider writes. Never confirms, never retries, never throws. */
    public AppointmentResult reconcileOnStartup(RunContext run) {
        return safe(() -> {
            Optional<Instant> now = clock.now(run);
            if (now.isEmpty()) return clockDown();
            return sweep(run, now.get(), true);
        });
    }

    private AppointmentResult sweep(RunContext run, Instant now, boolean startup) {
        return safe(() -> {
            if ("none".equals(provider.mode())) return notConfigured();
            RunContext sys = system(run);
            int orders = 0;
            int[] counts = new int[5];
            ArrayNode failed = JSON.createArrayNode();
            String after = "";
            while (true) {
                List<Row> page;
                try (Connection c = dataSource.getConnection()) {
                    page = AppointmentStore.page(c, sys, after, startup);
                } catch (SQLException e) {
                    return unavailable();
                }
                for (Row row : page) {
                    after = row.orderUuid();
                    orders++;
                    AppointmentResult step;
                    try {
                        step = progress(sys, now, startup, row);
                    } catch (RuntimeException | SQLException e) {
                        step = unavailable();
                    }
                    if (step instanceof AppointmentResult.Ok ok) {
                        counts[bucket(ok.value().asText())]++;
                    } else if (failed.size() < 20) {
                        failed.add(failure(row.orderUuid(), step));
                    }
                }
                if (page.size() < AppointmentStore.PAGE) break;
            }
            ObjectNode summary = JSON.createObjectNode().put("orders", orders).put("applied", counts[0])
                    .put("waiting", counts[1]).put("blocked", counts[2]).put("uncertain", counts[3]).put("idle", counts[4]);
            summary.set("failed", failed);
            return new AppointmentResult.Ok(summary);
        });
    }

    private static int bucket(String label) {
        return switch (label) {
            case "applied" -> 0;
            case "waiting" -> 1;
            case "blocked" -> 2;
            case "uncertain" -> 3;
            default -> 4;
        };
    }

    private static ObjectNode failure(String orderUuid, AppointmentResult r) {
        ObjectNode o = JSON.createObjectNode().put("orderUuid", orderUuid);
        switch (r) {
            case AppointmentResult.Unavailable u -> o.put("status", "unavailable").put("code", u.code());
            case AppointmentResult.Conflict c -> o.put("status", "conflict").put("code", c.code());
            case AppointmentResult.Pending p -> o.put("status", "pending").put("code", "outcome-uncertain");
            default -> o.put("status", "unavailable").putNull("code");
        }
        return o;
    }

    /** One appointment's tick step: an open op is reconciled first; an awaiting-confirmation one gets its confirm write. */
    private AppointmentResult progress(RunContext sys, Instant now, boolean startup, Row row) throws SQLException {
        Got<AppointmentConfig> cfg = config(row.policyVersion(), now);
        if (cfg.error != null) return cfg.error;
        if (row.pendingOperationId() != null) {
            Optional<Op> op = loadOp(sys, row.pendingOperationId());
            if (op.isEmpty() || !op.get().open()) return label(Label.SETTLED);
            return label(recover(sys, cfg.value, op.get(), now, !startup));
        }
        if (!"requested".equals(row.state()) || startup) return label(Label.SETTLED);
        String confirmId = AppointmentIds.operationId(sys.runId(), row.orderUuid(), "confirm");
        Optional<Op> existing = loadOp(sys, confirmId);
        Op op;
        if (existing.isPresent()) {
            if (!existing.get().open()) return label(Label.SETTLED);
            op = existing.get();
        } else {
            Instant requestedAt = null;
            try (Connection c = dataSource.getConnection()) {
                for (AppointmentStore.Hist h : AppointmentStore.history(c, sys, row.orderUuid())) {
                    if ("requested".equals(h.state())) requestedAt = h.at();
                }
            }
            if (requestedAt == null) return unavailable();
            long delay = row.confirmation().path("confirmDelaySeconds").asLong(0);
            ObjectNode payload = payload(row.orderUuid(), "confirm", row.requestedSlot());
            payload.put("confirmAfter", Iso.format(requestedAt.plusSeconds(delay)));
            payload.set("scenario", row.confirmation().get("scenario"));
            payload.set("slotPolicy", row.confirmation().get("slotPolicy"));
            op = openConfirm(sys, row, confirmId, payload);
            if (op == null) return label(Label.SETTLED);
        }
        return label(write(sys, cfg.value, op, now));
    }

    /** Creates the confirm intent once; null when the appointment moved on, otherwise the new operation. */
    private Op openConfirm(RunContext sys, Row row, String opId, ObjectNode payload) {
        ObjectNode input = JSON.createObjectNode().put("orderUuid", row.orderUuid()).put("step", "confirm");
        Outcome o = runner.execute(sys, new Command("appointment.confirm.open", "confirm-open:" + opId, input), tx -> {
            Optional<Row> now = AppointmentStore.row(tx.connection(), tx.context(), row.orderUuid());
            if (now.isEmpty() || !"requested".equals(now.get().state()) || now.get().pendingStep() != null) {
                return WorkResult.refuse("appointment-moved-on", "The appointment is no longer awaiting confirmation.");
            }
            PendingOperations.recordIntent(tx, opId, AppointmentIds.operationType("confirm"), opId, payload);
            AppointmentStore.insertInput(tx, opId, "confirm", row.orderUuid(), payload);
            return WorkResult.ok(JSON.createObjectNode().put("operationId", opId));
        });
        if (o instanceof Outcome.Committed) {
            return new Op(opId, "confirm", row.orderUuid(), "intent", 1, 0, null, Canonical.digest(payload), payload);
        }
        if (o instanceof Outcome.Refused) return null;
        throw new IllegalStateException("The confirm intent was not stored: " + o.code());
    }

    private static AppointmentResult label(Label l) {
        return new AppointmentResult.Ok(text(l));
    }

    private static JsonNode text(Label l) {
        return JSON.getNodeFactory().textNode(l.text);
    }

    // ---- request ----

    private AppointmentResult doRequest(Principal who, RunContext run, Prep prep, JsonNode input) throws SQLException {
        RunContext ctx = employee(run, who);
        String orderUuid = input.get("orderUuid").asText();
        String slotId = input.get("slotId").asText();
        String commandId = input.get("commandId").asText();
        long expected = Values.integer(input.get("expectedVersion"));
        ObjectNode cmdInput = JSON.createObjectNode().put("orderUuid", orderUuid).put("slotId", slotId)
                .put("expectedVersion", expected);
        for (int attempt = 0; attempt < 2; attempt++) {
            Optional<Row> existing;
            try (Connection c = dataSource.getConnection()) {
                if (AppointmentStore.probe(c, ctx, commandId, Canonical.digest(cmdInput)) == Probe.DIFFERENT) {
                    return new AppointmentResult.Conflict("command-input-changed", "The command id was used with different input.");
                }
                existing = AppointmentStore.row(c, ctx, orderUuid);
            }
            if (existing.isPresent()) {
                Row p = existing.get();
                if (!Access.owns(who, p.employeeId())) return foreignAppointment();
                if (p.requestedSlot() == null || !slotId.equals(p.requestedSlot().slotId())) {
                    return new AppointmentResult.Conflict("appointment-already-requested",
                            "A slot is already requested for this order.");
                }
                return readModel(who, run, prep, orderUuid);
            }
            if (expected != 0) return stale(0);
            Got<AppointmentConfig> cfg = config(who.policyVersion(), prep.now);
            if (cfg.error != null) return cfg.error;
            Seen seen = observe(run, orderUuid, cfg.value);
            if (seen.error != null) return seen.error;
            if (seen.employeeId != null && !seen.employeeId.equals(who.employeeId())) return foreignOrder();
            if (seen.open == null) {
                String reason = NOT_SENT_REASONS.contains(seen.reason) ? NOT_SENT : NOT_OPEN;
                ObjectNode extra = JSON.createObjectNode();
                extra.putArray("reasons").addObject().put("field", "orderUuid").put("reason", reason);
                return new AppointmentResult.Conflict("appointment-not-eligible", reason, extra);
            }
            Offer offer = offer(cfg.value, prep.now);
            if (offer.refused != null) {
                return offer.unsupported
                        ? new AppointmentResult.Unsupported(offer.refused.path("code").asText(),
                                offer.refused.path("reason").asText(), null)
                        : new AppointmentResult.Unavailable("offer-unavailable", OFFER_DOWN, true);
            }
            Slot slot = offer.slots.stream().filter(s -> s.slotId().equals(slotId)).findFirst().orElse(null);
            if (slot == null) {
                return new AppointmentResult.Invalid(INVALID, List.of(reason("slotId", "Choose one of the offered slots.")));
            }
            String opId = AppointmentIds.operationId(run.runId(), orderUuid, "request");
            ObjectNode payload = payload(orderUuid, "request", slot);
            payload.put("requestedAt", Iso.format(prep.now));
            ObjectNode opening = opening(seen.open);
            ObjectNode confirmation = confirmation(cfg.value);
            Outcome o = runner.execute(ctx, new Command("appointment.request", commandId, cmdInput), tx -> {
                AppointmentStore.insertAppointment(tx, orderUuid, who.employeeId(), cfg.value.policyVersion(),
                        provider.mode(), opening, confirmation, slot, opId);
                PendingOperations.recordIntent(tx, opId, AppointmentIds.operationType("request"), opId, payload);
                AppointmentStore.insertInput(tx, opId, "request", orderUuid, payload);
                return WorkResult.ok(JSON.createObjectNode().put("operationId", opId));
            });
            if (o instanceof Outcome.Conflict c && "duplicate-record".equals(c.code())) continue;
            if (!(o instanceof Outcome.Committed)) return mapped(o);
            Op op = new Op(opId, "request", orderUuid, "intent", 1, 0, null, Canonical.digest(payload), payload);
            String done = write(system(run), cfg.value, op, prep.now).text;
            return after(who, run, prep, orderUuid, done);
        }
        return new AppointmentResult.Conflict("appointment-already-requested", "A slot is already requested for this order.");
    }

    // ---- accept ----

    private AppointmentResult doAccept(Principal who, RunContext run, Prep prep, JsonNode input) throws SQLException {
        RunContext ctx = employee(run, who);
        String orderUuid = input.get("orderUuid").asText();
        String proposalId = input.get("proposalId").asText();
        String commandId = input.get("commandId").asText();
        long expected = Values.integer(input.get("expectedVersion"));
        ObjectNode cmdInput = JSON.createObjectNode().put("orderUuid", orderUuid).put("proposalId", proposalId)
                .put("expectedVersion", expected);
        Row p;
        Optional<Op> prior;
        String opId = AppointmentIds.operationId(run.runId(), orderUuid, "accept");
        try (Connection c = dataSource.getConnection()) {
            if (AppointmentStore.probe(c, ctx, commandId, Canonical.digest(cmdInput)) == Probe.DIFFERENT) {
                return new AppointmentResult.Conflict("command-input-changed", "The command id was used with different input.");
            }
            Optional<Row> found = AppointmentStore.row(c, ctx, orderUuid);
            if (found.isEmpty()) {
                return new AppointmentResult.NotFound("appointment", "No appointment was requested for this order.");
            }
            p = found.get();
            if (!Access.owns(who, p.employeeId())) return foreignAppointment();
            if ("scheduled".equals(p.state()) && proposalId.equals(p.acceptedProposalId())) {
                return readModel(who, run, prep, orderUuid);
            }
            if (!"change-proposed".equals(p.state())) {
                return new AppointmentResult.Conflict("no-change-proposed", "There is no proposed change to accept.");
            }
            if (!proposalId.equals(p.proposalId())) {
                return new AppointmentResult.Invalid(INVALID, List.of(reason("proposalId", "This is not the proposed change.")));
            }
            prior = AppointmentStore.op(c, ctx, opId);
        }
        Got<AppointmentConfig> cfg = config(p.policyVersion(), prep.now);
        if (cfg.error != null) return cfg.error;
        if (prior.isPresent()) {
            String label = "refused".equals(prior.get().state()) ? "blocked" : "repeat";
            return after(who, run, prep, orderUuid, label);
        }
        if (expected != p.version()) return stale(p.version());
        ObjectNode payload = payload(orderUuid, "accept", p.requestedSlot());
        payload.put("acceptedAt", Iso.format(prep.now));
        payload.set("proposedSlot", p.proposedSlot().toJson());
        payload.put("proposalId", p.proposalId());
        Outcome o = runner.execute(ctx, new Command("appointment.accept", commandId, cmdInput), tx -> {
            tx.cas("UPDATE appointments SET pending_step = 'accept', pending_operation_id = ?, blocked = NULL, "
                    + "version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                    + "AND order_uuid = ? AND version = ? AND state = 'change-proposed' AND pending_step IS NULL",
                    opId, ctx.environmentId(), ctx.runId(), orderUuid, expected);
            PendingOperations.recordIntent(tx, opId, AppointmentIds.operationType("accept"), opId, payload);
            AppointmentStore.insertInput(tx, opId, "accept", orderUuid, payload);
            return WorkResult.ok(JSON.createObjectNode().put("operationId", opId));
        });
        if (o instanceof Outcome.Conflict c && "stale-version".equals(c.code())) return stale(currentVersion(ctx, orderUuid));
        if (!(o instanceof Outcome.Committed)) return mapped(o);
        Op op = new Op(opId, "accept", orderUuid, "intent", 1, 0, null, Canonical.digest(payload), payload);
        return after(who, run, prep, orderUuid, write(system(run), cfg.value, op, prep.now).text);
    }

    private long currentVersion(RunContext ctx, String orderUuid) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return AppointmentStore.row(c, ctx, orderUuid).map(Row::version).orElse(0L);
        }
    }

    // ---- provider writes and settling ----

    private enum Label {
        APPLIED("applied"), WAITING("waiting"), BLOCKED("blocked"), UNCERTAIN("uncertain"), SETTLED("settled");

        final String text;

        Label(String text) {
            this.text = text;
        }
    }

    private Label write(RunContext sys, AppointmentConfig cfg, Op op, Instant now) {
        ProviderAnswer answer = calls.write(provider, op.toProvider(sys), now, cfg.providerTimeoutMs());
        return settle(sys, op, answer);
    }

    /** Uncertain writes are reconciled under the same operation id; only not-found allows the same write again. */
    private Label recover(RunContext sys, AppointmentConfig cfg, Op op, Instant now, boolean retry) {
        ProviderAnswer answer = calls.reconcile(provider, op.toProvider(sys), cfg.providerTimeoutMs());
        if (answer instanceof ProviderAnswer.NotFound nf && op.operationId().equals(nf.operationId())) {
            if (!retry) return Label.WAITING;
            answer = calls.write(provider, op.toProvider(sys), now, cfg.providerTimeoutMs());
        }
        return settle(sys, op, answer);
    }

    /** One system command: CAS the operation and the appointment; a finished or moved-on one changes nothing. */
    private Label settle(RunContext sys, Op op, ProviderAnswer answer) {
        boolean good = ProviderCalls.expected(op, answer);
        boolean waiting = !good && "confirm".equals(op.step()) && answer instanceof ProviderAnswer.InProgress ip
                && op.operationId().equals(ip.operationId());
        boolean refused = !good && !waiting && answer instanceof ProviderAnswer.Unsupported;
        Label label = good ? Label.APPLIED : waiting ? Label.WAITING : refused ? Label.BLOCKED : Label.UNCERTAIN;
        ObjectNode input = JSON.createObjectNode().put("operationId", op.operationId()).put("opVersion", op.version());
        input.set("answer", good ? AnswerJson.toJson(answer) : JSON.createObjectNode().put("label", label.text)
                .put("code", answer instanceof ProviderAnswer.Unsupported u ? u.code() : null));
        Command cmd = new Command("appointment.settle", "settle:" + op.operationId() + ":" + op.version(), input);
        Outcome o = runner.execute(sys, cmd, tx -> {
            Optional<Row> found = AppointmentStore.row(tx.connection(), tx.context(), op.orderUuid());
            String from = switch (op.step()) {
                case "request" -> "not-requested";
                case "confirm" -> "requested";
                default -> "change-proposed";
            };
            if (found.isEmpty() || !from.equals(found.get().state())) return WorkResult.ok(text(Label.SETTLED));
            Row row = found.get();
            Edit e = new Edit(row);
            if (op.operationId().equals(row.pendingOperationId())) {
                e.pendingStep = null;
                e.pendingOperationId = null;
            }
            if (good) {
                applyGood(tx, op, (ProviderAnswer.Done) answer, row, e);
            } else if (waiting) {
                if (op.inProgress()) return WorkResult.ok(text(Label.WAITING));
                PendingOperations.markPending(tx, op.operationId(), op.version(), JSON.createObjectNode().put("status", "in-progress"));
            } else if (refused) {
                ProviderAnswer.Unsupported u = (ProviderAnswer.Unsupported) answer;
                String code = Values.id(u.code(), 128) ? u.code() : "unsupported";
                String reason = Values.id(u.reason(), 500) ? u.reason() : "This update is not supported.";
                e.blocked = JSON.createObjectNode().put("step", op.step()).put("code", code).put("reason", reason);
                PendingOperations.finalize(tx, op.operationId(), op.version(), "refused", null,
                        JSON.createObjectNode().put("status", "unsupported").put("code", code).put("reason", reason));
            } else {
                e.blocked = null;
                e.pendingStep = op.step();
                e.pendingOperationId = op.operationId();
                PendingOperations.markPending(tx, op.operationId(), op.version(), JSON.createObjectNode().put("status", "unknown"));
            }
            if (e.differs(row)) AppointmentStore.save(tx, row, e);
            return WorkResult.ok(text(label));
        });
        if (o instanceof Outcome.Committed c) return fromText(c.result().asText());
        return o instanceof Outcome.Uncertain ? Label.UNCERTAIN : Label.SETTLED;
    }

    private static Label fromText(String text) {
        for (Label l : Label.values()) if (l.text.equals(text)) return l;
        return Label.SETTLED;
    }

    /** A provider success: finalize the operation, move the state and append the history entry. */
    private static void applyGood(gcsp.api.persistence.Tx tx, Op op, ProviderAnswer.Done d, Row row, Edit e)
            throws SQLException {
        e.blocked = null;
        String state;
        switch (op.step()) {
            case "request" -> state = "requested";
            case "accept" -> {
                state = "scheduled";
                e.slot = row.proposedSlot();
                e.acceptedProposalId = row.proposalId();
            }
            default -> {
                if (d instanceof ProviderAnswer.Proposed p) {
                    state = "change-proposed";
                    e.proposedSlot = p.proposedSlot();
                    e.proposalId = p.proposalId();
                } else {
                    state = "scheduled";
                    e.slot = d.slot();
                }
            }
        }
        e.state = state;
        PendingOperations.finalize(tx, op.operationId(), op.version(), "acknowledged", d.providerReference(),
                AnswerJson.toJson(d));
        AppointmentStore.addHistory(tx, row.orderUuid(), state, d.at(), d.providerReference());
    }

    // ---- read model ----

    private AppointmentResult after(Principal who, RunContext run, Prep prep, String orderUuid, String label)
            throws SQLException {
        AppointmentResult model = readModel(who, run, prep, orderUuid);
        if (!"blocked".equals(label) || !(model instanceof AppointmentResult.Ok ok)) return model;
        JsonNode blocked = ok.value().get("blocked");
        return blocked == null || blocked.isNull() ? model : new AppointmentResult.Unsupported(
                blocked.path("code").asText(), blocked.path("reason").asText(), ok.value());
    }

    private AppointmentResult readModel(Principal who, RunContext run, Prep prep, String orderUuid) throws SQLException {
        boolean employee = who.roles().contains(Role.EMPLOYEE.wire());
        Optional<Row> found;
        try (Connection c = dataSource.getConnection()) {
            found = AppointmentStore.row(c, run, orderUuid);
            if (found.isPresent()) found = Optional.of(found.get().withHistory(AppointmentStore.history(c, run, orderUuid)));
        }
        if (found.isPresent()) {
            Row p = found.get();
            if (employee && !Access.owns(who, p.employeeId())) return foreignAppointment();
            Got<AppointmentConfig> cfg = config(p.policyVersion(), prep.now);
            if (cfg.error != null) return cfg.error;
            return model(run, p, cfg.value, ReadModel.Eligibility.OPEN, List.of(), null);
        }
        Got<AppointmentConfig> cfg = config(who.policyVersion(), prep.now);
        if (cfg.error != null) return cfg.error;
        Seen seen = observe(run, orderUuid, cfg.value);
        if (seen.error != null) return seen.error;
        if (employee && seen.employeeId != null && !seen.employeeId.equals(who.employeeId())) return foreignOrder();
        boolean open = seen.open != null;
        ReadModel.Eligibility eligibility = open ? ReadModel.Eligibility.OPEN : new ReadModel.Eligibility(false,
                seen.reason == null ? "not-open" : seen.reason, NOT_SENT_REASONS.contains(seen.reason) ? NOT_SENT : NOT_OPEN);
        Offer offer = open ? offer(cfg.value, prep.now) : new Offer(List.of(), null, false);
        String owner = seen.employeeId != null ? seen.employeeId : who.employeeId();
        Row blank = new Row(orderUuid, owner, "not-requested", cfg.value.policyVersion(), provider.mode(), null, null, null,
                null, null, null, null, null, null, null, null, 0, List.of());
        return model(run, blank, cfg.value, eligibility, offer.slots, offer.refused);
    }

    private AppointmentResult model(RunContext run, Row p, AppointmentConfig cfg, ReadModel.Eligibility eligibility,
            List<Slot> offered, JsonNode offerBlocked) {
        return new AppointmentResult.Ok(ReadModel.build(run.runId(), p, cfg, eligibility, offered, offerBlocked, provider));
    }

    // ---- shared pieces ----

    private static final Set<String> NOT_SENT_REASONS = Set.of("opening-stage-not-reached", "opening-stage-not-in-lifecycle");

    private record Prep(Instant now, AppointmentResult error) {}

    private record Got<T>(T value, AppointmentResult error) {}

    private record Seen(StageObservation.Open open, String employeeId, String reason, AppointmentResult error) {}

    private record Offer(List<Slot> slots, JsonNode refused, boolean unsupported) {}

    private Prep prepare(Principal who, RunContext run) {
        if ("none".equals(provider.mode())) return new Prep(null, notConfigured());
        Optional<Instant> now = clock.now(run);
        return now.isEmpty() ? new Prep(null, clockDown()) : new Prep(now.get(), null);
    }

    private Got<AppointmentConfig> config(String policyVersion, Instant asOf) {
        PolicyResult<AppointmentConfig> r = policy.config(policyVersion, asOf);
        if (r instanceof PolicyResult.Ok<AppointmentConfig> ok) return new Got<>(ok.value(), null);
        PolicyResult.Unavailable<AppointmentConfig> u = (PolicyResult.Unavailable<AppointmentConfig>) r;
        return new Got<>(null, new AppointmentResult.Unavailable(u.code(), u.reason(), u.retryable()));
    }

    /** Reads the order's lifecycle stages through the port and classifies them like Node observeStage. */
    private Seen observe(RunContext run, String orderUuid, AppointmentConfig cfg) {
        StageRead read = stages.read(run, orderUuid);
        if (read instanceof StageRead.NotFound) {
            return new Seen(null, null, null, new AppointmentResult.NotFound("order", "No order was found."));
        }
        StageObservation seen = StageObservation.classify(read, run.runId(), orderUuid, cfg.openingStage(), cfg.openingState());
        return switch (seen) {
            case StageObservation.Forbidden f -> new Seen(null, null, null, foreignOrder());
            case StageObservation.Open o -> new Seen(o, o.employeeId(), null, null);
            case StageObservation.NotOpen n -> new Seen(null, n.employeeId(), n.reason(), null);
        };
    }

    private Offer offer(AppointmentConfig cfg, Instant now) {
        SlotOffer offer = calls.offer(provider, now, cfg.slotPolicy(), cfg.providerTimeoutMs());
        if (offer instanceof SlotOffer.Offered o && o.slots().stream().allMatch(Slot::valid)) return new Offer(o.slots(), null, false);
        if (offer instanceof SlotOffer.Unsupported u) {
            return new Offer(List.of(), JSON.createObjectNode().put("step", "offer").put("code", u.code())
                    .put("reason", u.reason()), true);
        }
        return new Offer(List.of(), JSON.createObjectNode().put("step", "offer").put("code", "offer-unavailable")
                .put("reason", OFFER_DOWN), false);
    }

    private Optional<Op> loadOp(RunContext ctx, String operationId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return AppointmentStore.op(c, ctx, operationId);
        }
    }

    private static ObjectNode payload(String orderUuid, String step, Slot slot) {
        ObjectNode o = JSON.createObjectNode().put("orderUuid", orderUuid).put("step", step);
        o.set("slot", slot.toJson());
        return o;
    }

    private static ObjectNode opening(StageObservation.Open open) {
        StageObservation.Observed ob = open.observation();
        ObjectNode o = JSON.createObjectNode().put("contractVersion", ob.contractVersion()).put("stage", ob.stage())
                .put("state", ob.state()).put("stageAt", ob.stageAt()).put("lifecycleRevision", ob.lifecycleRevision())
                .put("stagePolicyVersion", ob.stagePolicyVersion());
        if (ob.providerReference() == null) o.putNull("providerReference"); else o.put("providerReference", ob.providerReference());
        StageObservation.Order order = open.order();
        ObjectNode ord = o.putObject("order").put("renewalAuthority", order.renewalAuthority());
        if (order.entitlementSlotId() == null) ord.putNull("entitlementSlotId"); else ord.put("entitlementSlotId", order.entitlementSlotId());
        if (order.renewalId() == null) ord.putNull("renewalId"); else ord.put("renewalId", order.renewalId());
        return o;
    }

    /** What a later tick needs to build the confirm write, pinned when the request is made. */
    private static ObjectNode confirmation(AppointmentConfig cfg) {
        ObjectNode o = JSON.createObjectNode().put("confirmDelaySeconds", cfg.confirmDelaySeconds());
        o.putObject("scenario").put("proposeChange", cfg.scenario().proposeChange())
                .put("proposedSlot", cfg.scenario().proposedSlot()).put("proposalReason", cfg.scenario().proposalReason());
        o.set("slotPolicy", cfg.slotPolicy().toJson());
        return o;
    }

    private static List<AppointmentResult.Reason> fields(JsonNode input, Set<String> allowed) {
        List<AppointmentResult.Reason> bad = new ArrayList<>();
        if (input == null || !input.isObject()) {
            bad.add(reason("input", "Send the details as an object."));
            return bad;
        }
        input.fieldNames().forEachRemaining(n -> {
            if (!allowed.contains(n)) bad.add(reason(n, "This field is not accepted."));
        });
        return bad;
    }

    private static void commandFields(JsonNode input, List<AppointmentResult.Reason> bad) {
        if (!Values.id(input == null ? null : input.get("commandId"), 200)) bad.add(reason("commandId", "Supply a command id."));
        if (!Values.integerIn(input == null ? null : input.get("expectedVersion"), 0, Long.MAX_VALUE)) {
            bad.add(reason("expectedVersion", "Supply the version you saw, or 0 if there is no appointment yet."));
        }
    }

    private static AppointmentResult.Reason reason(String field, String text) {
        return new AppointmentResult.Reason(field, text);
    }

    private static AppointmentResult role(Principal who, Role... allowed) {
        try {
            Access.requireAnyRole(who, allowed);
            return null;
        } catch (IdentityRefusal e) {
            return new AppointmentResult.Forbidden(e.code(), e.reason());
        }
    }

    private static RunContext system(RunContext run) {
        return new RunContext(run.environmentId(), run.runId(), SYSTEM_ACTOR);
    }

    private static RunContext employee(RunContext run, Principal who) {
        return new RunContext(run.environmentId(), run.runId(), who.employeeId());
    }

    private static AppointmentResult stale(long currentVersion) {
        return new AppointmentResult.Conflict("stale-version", "The appointment changed since you saw it.",
                JSON.createObjectNode().put("currentVersion", currentVersion));
    }

    private static AppointmentResult foreignAppointment() {
        return new AppointmentResult.Forbidden("not-resource-owner", "This appointment belongs to another employee.");
    }

    private static AppointmentResult foreignOrder() {
        return new AppointmentResult.Forbidden("not-resource-owner", "This order belongs to another employee.");
    }

    private static AppointmentResult clockDown() {
        return new AppointmentResult.Unavailable("appointments-clock-unavailable",
                "Appointment time is not set yet. Ask the presenter to start the clock.", true);
    }

    private static AppointmentResult notConfigured() {
        return new AppointmentResult.Unavailable("appointments-provider-not-configured",
                "Appointments are not set up in this environment yet.", false);
    }

    private static AppointmentResult unavailable() {
        return new AppointmentResult.Unavailable("appointments-unavailable", DOWN, true);
    }

    private static AppointmentResult mapped(Outcome o) {
        return switch (o) {
            case Outcome.Committed c -> new AppointmentResult.Ok(c.result());
            case Outcome.Conflict c -> new AppointmentResult.Conflict(c.code(), c.message());
            case Outcome.Refused r -> new AppointmentResult.Conflict(r.code(), r.message());
            case Outcome.Uncertain u -> new AppointmentResult.Pending(u.operationId());
            case Outcome.Unavailable u -> new AppointmentResult.Unavailable(u.code(), u.message(), true);
        };
    }

    private interface Work {
        AppointmentResult run() throws Exception;
    }

    private AppointmentResult safe(Work work) {
        try {
            return work.run();
        } catch (Exception | StackOverflowError e) {
            return unavailable();
        }
    }
}
