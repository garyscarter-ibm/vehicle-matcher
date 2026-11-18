package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import gcsp.api.production.ProductionStore.ConfirmationRow;
import gcsp.api.production.ProductionStore.RequestRow;
import gcsp.api.production.ProductionStore.SubmissionRow;
import java.io.IOException;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * Greg's tracking read and the planner-facing supply read. Each is one snapshot of a handful of per-table queries,
 * never a query per row, so the statement count does not grow with the run's history.
 */
final class ProductionReads {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String DB_CODE = "database-unavailable";
    private static final String DB_REASON = "The database could not be reached. Try again shortly.";
    private static final String DISAGREE = "Supply quantities disagree with their release history.";

    private final DataSource dataSource;
    private final ProductionProviderPort provider;
    private final ProductionClock clock;

    ProductionReads(DataSource dataSource, ProductionProviderPort provider, ProductionClock clock) {
        this.dataSource = dataSource;
        this.provider = provider;
        this.clock = clock;
    }

    private record Response(String requestId, int seq, String state, Instant at, JsonNode details) {}

    private record Queue(Instant eligibleFrom) {}

    /** Everything one read needs, taken from one snapshot. */
    private record Data(List<SubmissionRow> submissions, List<RequestRow> requests, List<ConfirmationRow> confirmations,
            List<Response> responses, Map<String, Queue> queue, Map<String, Integer> released) {}

    private interface Read<T> {
        T run(Connection c) throws SQLException;
    }

    private <T> T snapshot(Read<T> read) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            c.setReadOnly(true);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            try {
                return read.run(c);
            } finally {
                c.rollback();
                c.setReadOnly(false);
                c.setAutoCommit(true);
                c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            }
        }
    }

    private Data load(Connection c, RunContext ctx, boolean withRelease) throws SQLException {
        List<SubmissionRow> subs = ProductionStore.submissionsOfRun(c, ctx);
        List<RequestRow> requests = ProductionStore.requestsOfRun(c, ctx);
        List<ConfirmationRow> confirmations = ProductionStore.confirmationsOfRun(c, ctx);
        List<Response> responses = responses(c, ctx);
        Map<String, Queue> queue = new HashMap<>();
        Map<String, Integer> released = new HashMap<>();
        if (withRelease && !confirmations.isEmpty()) {
            Array ids = c.createArrayOf("text", confirmations.stream().map(ConfirmationRow::supplyId).toArray());
            try (PreparedStatement ps = c.prepareStatement("SELECT supply_id, eligible_from FROM confirmed_supply_queue "
                    + "WHERE environment_id = ? AND run_id = ? AND supply_id = ANY(?)")) {
                ps.setString(1, ctx.environmentId());
                ps.setString(2, ctx.runId());
                ps.setArray(3, ids);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) queue.put(rs.getString(1), new Queue(rs.getObject(2, OffsetDateTime.class).toInstant()));
                }
            }
            try (PreparedStatement ps = c.prepareStatement("SELECT supply_id, sum(jsonb_array_length(order_uuids))::int "
                    + "FROM stock_releases WHERE environment_id = ? AND run_id = ? AND supply_id = ANY(?) GROUP BY supply_id")) {
                ps.setString(1, ctx.environmentId());
                ps.setString(2, ctx.runId());
                ps.setArray(3, ids);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) released.put(rs.getString(1), rs.getInt(2));
                }
            }
        }
        return new Data(subs, requests, confirmations, responses, queue, released);
    }

    private static List<Response> responses(Connection c, RunContext ctx) throws SQLException {
        List<Response> out = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT request_id, seq, state, at, details::text FROM production_responses "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY at, request_id, seq")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    try {
                        out.add(new Response(rs.getString(1), rs.getInt(2), rs.getString(3),
                                rs.getObject(4, OffsetDateTime.class).toInstant(), JSON.readTree(rs.getString(5))));
                    } catch (IOException e) {
                        throw new SQLException("Stored response is unreadable");
                    }
                }
            }
        }
        return out;
    }

    // ---- Greg's tracking read ----

    ProductionResult status(RunContext ctx) {
        return read(ctx, null);
    }

    /** Greg's order tracking: the status value plus the policy, stock and clock versions his next request must quote. */
    ProductionResult orders(RunContext ctx, String policyVersion) {
        return read(ctx, policyVersion == null ? "" : policyVersion);
    }

    private record Snap(Data data, String stock) {}

    private ProductionResult read(RunContext ctx, String policyVersion) {
        Optional<Instant> now;
        try {
            now = clock.now(ctx);
        } catch (RuntimeException e) {
            return unavailable();
        }
        if (now.isEmpty()) return new ProductionResult.Unavailable("clock-not-set", "The demo clock has not been set. Try again shortly.", true);
        try {
            Snap s = snapshot(c -> new Snap(load(c, ctx, true), policyVersion == null ? null : ProductionStore.stockVersion(c, ctx)));
            ProductionResult r = statusOf(s.data(), Ids.ms(now.get()));
            if (policyVersion != null && r instanceof ProductionResult.Ok ok && ok.value() instanceof ObjectNode o) {
                ObjectNode v = o.putObject("versions");
                v.put("policy", policyVersion);
                v.put("stock", s.stock());
                v.put("clock", Ids.ms(now.get()).toString());
            }
            return r;
        } catch (SQLException | RuntimeException e) {
            return unavailable();
        }
    }

    private ProductionResult statusOf(Data d, Instant now) {
        Map<String, List<ConfirmationRow>> byRequest = new HashMap<>();
        for (ConfirmationRow cr : d.confirmations()) byRequest.computeIfAbsent(cr.requestId(), k -> new ArrayList<>()).add(cr);
        ObjectNode out = F.objectNode();
        out.put("asOf", now.toString());
        out.set("provider", describe());
        ArrayNode subs = out.putArray("submissions");
        for (SubmissionRow s : d.submissions()) {
            ObjectNode n = subs.addObject();
            n.put("submissionId", s.submissionId());
            n.put("planId", s.planId());
            n.put("requestedAt", s.requestedAt().toString());
        }
        Map<String, String> planOf = new HashMap<>();
        d.submissions().forEach(s -> planOf.put(s.submissionId(), s.planId()));
        ArrayNode list = out.putArray("requests");
        for (RequestRow r : d.requests()) {
            List<ConfirmationRow> supplies = byRequest.getOrDefault(r.requestId(), List.of());
            int confirmed = 0;
            int queued = 0;
            int released = 0;
            ArrayNode supplyJson = F.arrayNode();
            for (ConfirmationRow s : supplies) {
                Queue q = d.queue().get(s.supplyId());
                boolean isQueued = s.queuedAt() != null || q != null;
                int rel = d.released().getOrDefault(s.supplyId(), 0);
                if (rel > s.quantity()) return disagree();
                confirmed += s.quantity();
                if (isQueued) queued += s.quantity();
                released += rel;
                ObjectNode sn = supplyJson.addObject();
                sn.put("supplyId", s.supplyId());
                sn.put("quantity", s.quantity());
                sn.put("confirmedAt", s.confirmedAt().toString());
                sn.put("queued", isQueued);
                Instant eligible = q != null ? q.eligibleFrom() : s.eligibleFrom();
                sn.put("eligibleFrom", eligible == null ? null : eligible.toString());
                sn.put("releasedQuantity", rel);
            }
            if (confirmed > r.quantity() || confirmed != r.confirmedQuantity() || released > confirmed) return disagree();
            ObjectNode n = list.addObject();
            n.put("requestId", r.requestId());
            n.put("submissionId", r.submissionId());
            n.put("planId", planOf.get(r.submissionId()));
            n.put("lineId", r.lineId());
            n.put("model", r.model());
            n.put("derivative", r.derivative());
            n.put("quantity", r.quantity());
            n.put("state", r.state());
            n.put("version", r.version());
            n.put("providerMode", r.providerMode());
            n.put("providerReference", r.providerReference());
            n.put("code", r.refusalCode());
            n.put("reason", r.refusalReason() != null ? r.refusalReason() : r.delayReason());
            n.put("delayUntil", r.delayUntil() == null ? null : r.delayUntil().toString());
            n.put("requestedAt", r.requestedAt().toString());
            n.put("confirmedQuantity", confirmed);
            n.put("queuedQuantity", queued);
            n.put("releasedQuantity", released);
            n.put("outstandingQuantity", r.quantity() - confirmed);
            String stage = released == r.quantity() ? "released" : released > 0 ? "partly-released" : r.state();
            n.put("stage", stage);
            n.put("message", message(r, confirmed, queued, released));
            n.set("supplies", supplyJson);
            ArrayNode history = n.putArray("history");
            for (Response h : d.responses()) {
                if (!h.requestId().equals(r.requestId())) continue;
                ObjectNode hn = history.addObject();
                hn.put("seq", h.seq());
                hn.put("state", h.state());
                hn.put("at", h.at().toString());
                hn.set("details", h.details());
            }
        }
        return new ProductionResult.Ok(out, false);
    }

    private static String message(RequestRow r, int confirmed, int queued, int released) {
        String of = confirmed + " of " + r.quantity() + " confirmed.";
        return switch (r.state()) {
            case "intent", "uncertain" -> "Production has not answered yet. Retry the submission to continue without duplicates.";
            case "requested" -> "Requested. Production has not confirmed any of this yet.";
            case "refused", "unsupported" -> r.refusalReason();
            default -> {
                String text = "delayed".equals(r.state())
                        ? "Delayed: " + (r.delayReason() == null ? "Production gave no reason." : r.delayReason()) + " " + of : of;
                if (confirmed > queued) text += " Confirmed. Waiting to join the release queue.";
                if (released > 0) text += " " + released + " released to stock.";
                yield text;
            }
        };
    }

    private ObjectNode describe() {
        ProductionProviderPort.Description d = provider.describe();
        ObjectNode n = F.objectNode();
        n.put("mode", d.mode());
        n.put("provider", d.provider());
        n.put("sourceVersion", d.sourceVersion());
        n.put("status", d.status());
        ArrayNode choices = n.putArray("choices");
        for (ProductionProviderPort.Choice ch : d.choices() == null ? List.<ProductionProviderPort.Choice>of() : d.choices()) {
            choices.addObject().put("model", ch.model()).put("derivative", ch.derivative());
        }
        return n;
    }

    private static ProductionResult disagree() {
        return new ProductionResult.Unavailable("supply-quantities-disagree", DISAGREE, false);
    }

    private static ProductionResult unavailable() {
        return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
    }

    // ---- the planner-facing read ----

    ProductionResult supplyActivity(RunContext ctx) {
        try {
            Data d = snapshot(c -> load(c, ctx, true));
            return activityOf(d);
        } catch (SQLException | RuntimeException e) {
            return unavailable();
        }
    }

    /** The replan value for Greg's order-plan read: the latest submission's state against the plan he now sees (Node replanFor). */
    ProductionResult replanFor(RunContext ctx, String currentPlanId) {
        try {
            Data d = snapshot(c -> load(c, ctx, true));
            ObjectNode out = replan(d);
            if ("no-submission".equals(out.path("status").asText())) return new ProductionResult.Ok(out, false);
            String latest = latestSubmission(d).map(SubmissionRow::submissionId).orElse("");
            Map<String, Integer> releasedOf = releasedOf(d);
            Map<String, String> planOf = planOf(d);
            ObjectNode head = F.objectNode();
            head.put("status", out.get("status").asText());
            head.set("submittedPlanId", out.get("submittedPlanId"));
            head.set("submittedAt", out.get("submittedAt"));
            head.put("currentPlanId", currentPlanId);
            head.putArray("changes");
            ArrayNode mine = head.putArray("requests");
            d.requests().stream().filter(r -> r.submissionId().equals(latest)).forEach(r -> mine.add(requestJson(r, planOf, releasedOf)));
            head.set("responses", out.get("responses"));
            if (out.has("after")) head.set("after", out.get("after"));
            return new ProductionResult.Ok(head, false);
        } catch (SQLException | RuntimeException e) {
            return unavailable();
        }
    }

    private static Map<String, Integer> releasedOf(Data d) {
        Map<String, Integer> releasedOf = new HashMap<>();
        for (ConfirmationRow s : d.confirmations()) {
            releasedOf.merge(s.requestId(), d.released().getOrDefault(s.supplyId(), 0), Integer::sum);
        }
        return releasedOf;
    }

    private static Map<String, String> planOf(Data d) {
        Map<String, String> planOf = new HashMap<>();
        d.submissions().forEach(s -> planOf.put(s.submissionId(), s.planId()));
        return planOf;
    }

    private static ObjectNode requestJson(RequestRow r, Map<String, String> planOf, Map<String, Integer> releasedOf) {
        ObjectNode n = F.objectNode();
        n.put("requestId", r.requestId());
        n.put("submissionId", r.submissionId());
        n.put("planId", planOf.get(r.submissionId()));
        n.put("model", r.model());
        n.put("derivative", r.derivative());
        n.put("quantity", r.quantity());
        n.put("state", r.state());
        n.put("confirmedQuantity", r.confirmedQuantity());
        n.put("releasedQuantity", releasedOf.getOrDefault(r.requestId(), 0));
        return n;
    }

    /** A manual request (Greg's single line) is not a plan, so replan history never starts from it. */
    static final String MANUAL_PREFIX = "manual:";

    private static Optional<SubmissionRow> latestSubmission(Data d) {
        return d.submissions().stream().filter(s -> !s.planId().startsWith(MANUAL_PREFIX)).max(Comparator.comparing(SubmissionRow::requestedAt).thenComparing(SubmissionRow::submissionId));
    }

    private static ProductionResult activityOf(Data d) {
        Map<String, Integer> releasedOf = releasedOf(d);
        Map<String, Integer> lastSeq = new HashMap<>();
        d.responses().forEach(h -> lastSeq.merge(h.requestId(), h.seq(), Math::max));
        Map<String, String> planOf = planOf(d);
        List<RequestRow> sorted = new ArrayList<>(d.requests());
        sorted.sort(Comparator.comparing(RequestRow::requestId));
        List<ConfirmationRow> supplies = new ArrayList<>(d.confirmations());
        supplies.sort(Comparator.comparing(ConfirmationRow::supplyId));
        ArrayNode basis = F.arrayNode();
        for (RequestRow r : sorted) basis.addArray().add("request").add(r.requestId()).add(lastSeq.getOrDefault(r.requestId(), 0));
        for (ConfirmationRow s : supplies) basis.addArray().add("supply").add(s.supplyId()).add(s.queuedAt() != null);
        ObjectNode out = F.objectNode();
        out.put("supplyVersion", Canonical.digest(basis));
        ArrayNode requests = out.putArray("requests");
        for (RequestRow r : d.requests()) requests.add(requestJson(r, planOf, releasedOf));
        ArrayNode responses = out.putArray("responses");
        for (Response h : d.responses()) responses.add(responseJson(h));
        out.set("replan", replan(d));
        return new ProductionResult.Ok(out, false);
    }

    private static ObjectNode responseJson(Response h) {
        return F.objectNode().put("requestId", h.requestId()).put("seq", h.seq()).put("state", h.state()).put("at", h.at().toString());
    }

    /** Mirrors the Node replanFor; the "requested" acknowledgement is the submission itself, not a supply response. */
    private static ObjectNode replan(Data d) {
        ObjectNode out = F.objectNode();
        Optional<SubmissionRow> latest = latestSubmission(d);
        if (latest.isEmpty()) return out.put("status", "no-submission");
        SubmissionRow s = latest.get();
        java.util.Set<String> mine = new java.util.HashSet<>();
        d.requests().stream().filter(r -> r.submissionId().equals(s.submissionId())).forEach(r -> mine.add(r.requestId()));
        List<Response> after = d.responses().stream().filter(h -> mine.contains(h.requestId()) && !"requested".equals(h.state()) && !h.at().isBefore(s.requestedAt())).toList();
        out.put("status", after.isEmpty() ? "unchanged-since-submission" : "replanned");
        out.put("submittedPlanId", s.planId());
        out.put("submittedAt", s.requestedAt().toString());
        ArrayNode list = out.putArray("responses");
        after.forEach(h -> list.add(responseJson(h)));
        if (!after.isEmpty()) out.set("after", responseJson(after.get(after.size() - 1)));
        return out;
    }
}
