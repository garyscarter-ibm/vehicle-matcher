package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.brief.BriefAssumptions;
import gcsp.api.brief.BriefResult;
import gcsp.api.brief.BriefScope;
import gcsp.api.brief.BriefService;
import gcsp.api.brief.BriefServiceHolder;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The post-decline follow-up: the registered question, the one confirmed brief change that answers it (saved through
 * BriefService), and after it waiting, no-match or ready from the allocator's rows and the owner's offer reads.
 */
@ApplicationScoped
public class OfferFollowups {

    static final String KEY = "offer.followupQuestions.v1";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Set<String> CONFIRM_KEYS = Set.of("commandId", "decisionId", "expectedBriefVersion",
            "questionVersion", "value");
    private static final Pattern PATH = Pattern.compile("^(preferences)\\.([A-Za-z0-9_-]+)\\.value$|^(essentials)\\.([A-Za-z0-9_-]+)$");

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> sources;

    @Inject
    PolicyService policy;

    @Inject
    OfferClock clock;

    @Inject
    OfferAccess access;

    @Inject
    BriefServiceHolder briefs;

    /** Carries the typed answer out of a deep helper; anything unexpected becomes the unavailable answer. */
    private static final class Stop extends RuntimeException {
        final OfferOutcome outcome;

        Stop(OfferOutcome outcome) {
            super(null, null, false, false);
            this.outcome = outcome;
        }
    }

    private record Decision(String decisionId, String employeeId, String decision, String reasonCode, String reasonPolicy,
            String offerId) {}

    private record State(Decision decision, BriefService service, BriefScope scope, ArrayNode history, Instant now) {}

    /** The question as shown, with the pieces the confirm needs to check an answer against it. */
    private record Question(ObjectNode view, String kind, JsonNode control, String path, JsonNode current, JsonNode target) {}

    public OfferOutcome read(Principal p, String decisionId) {
        try {
            State s = prepare(p, decisionId);
            for (JsonNode row : s.history()) {
                if (decisionId.equals(row.path("postDeclineChange").path("decisionId").asText(null))) {
                    return afterSave(p, s, row);
                }
            }
            JsonNode brief = s.history().get(s.history().size() - 1);
            Question q = question(p, s, brief);
            ObjectNode value = F.objectNode();
            value.put("schemaVersion", 1);
            value.put("state", "question");
            value.put("decisionId", decisionId);
            value.put("briefVersion", brief.get("briefVersion").longValue());
            value.set("question", q.view());
            return OfferOutcome.ok(value);
        } catch (Stop e) {
            return e.outcome;
        } catch (RuntimeException | SQLException e) {
            return unavailable();
        }
    }

    public OfferOutcome confirm(Principal p, JsonNode body) {
        if (!validConfirm(body)) return invalid();
        String decisionId = body.get("decisionId").textValue();
        long expected = body.get("expectedBriefVersion").longValue();
        try {
            State s = prepare(p, decisionId);
            JsonNode brief = null;
            for (JsonNode row : s.history()) if (row.get("briefVersion").longValue() == expected) brief = row;
            long current = s.history().get(s.history().size() - 1).get("briefVersion").longValue();
            if (brief == null) return stale(expected, current);
            Question q = question(p, s, brief);
            if (!q.view().get("questionVersion").textValue().equals(body.get("questionVersion").textValue())) {
                return stale(expected, current);
            }
            JsonNode changeValue = changeValue(q, body.get("value"));
            if (changeValue == null) return invalid();
            ObjectNode in = F.objectNode();
            in.put("commandId", "followup:" + sha256(body.get("commandId").textValue()));
            in.put("decisionId", decisionId);
            in.put("expectedBriefVersion", expected);
            in.putObject("change").put("path", q.path()).set("value", changeValue);
            BriefResult result = s.service().changeAfterDecline(s.scope(), in);
            if (result instanceof BriefResult.Ok ok) {
                JsonNode saved = ok.value().path("brief");
                if (!decisionId.equals(saved.path("postDeclineChange").path("decisionId").asText(null))) return unavailable();
                return OfferOutcome.ok(savedChange(decisionId, saved));
            }
            if (result instanceof BriefResult.Refusal r) return refusal(r);
            return unavailable();
        } catch (Stop e) {
            return e.outcome;
        } catch (RuntimeException | SQLException e) {
            return unavailable();
        }
    }

    // ---- after the saved change ----

    /** Ready when exactly one new active offer fits the saved brief; else no-match or waiting from the allocator's run. */
    private OfferOutcome afterSave(Principal p, State s, JsonNode row) {
        String decisionId = s.decision().decisionId();
        ObjectNode saved = savedChange(decisionId, row);
        try {
            JsonNode current = s.history().get(s.history().size() - 1);
            long version = current.get("briefVersion").longValue();
            List<String> candidates = new ArrayList<>();
            String slot = null;
            try (Connection c = sources.get().getConnection()) {
                slot = OfferDecisions.one(c, "SELECT h.slot_id FROM offer_decisions d JOIN custody_holds h ON h.environment_id = d.environment_id "
                        + "AND h.run_id = d.run_id AND h.hold_id = d.hold_id WHERE d.environment_id = ? AND d.run_id = ? "
                        + "AND d.decision_id = ?", rs -> rs.getString(1), p.environmentId(), p.runId(), decisionId);
                try (var ps = c.prepareStatement("SELECT offer_id FROM buddy_offers WHERE environment_id = ? AND run_id = ? "
                        + "AND employee_id = ? AND offer_id <> ? AND state = 'active' AND brief_version = ? "
                        + "AND brief_version >= ? ORDER BY offer_id")) {
                    ps.setString(1, p.environmentId());
                    ps.setString(2, p.runId());
                    ps.setString(3, p.employeeId());
                    ps.setString(4, s.decision().offerId());
                    ps.setLong(5, version);
                    ps.setLong(6, row.get("briefVersion").longValue());
                    try (var rs = ps.executeQuery()) {
                        while (rs.next()) candidates.add(rs.getString(1));
                    }
                }
            }
            if (candidates.isEmpty()) return awaiting(p, s, current, saved);
            if (candidates.size() != 1 || slot == null) return unavailable("followup-evaluation-unavailable", saved);
            return ready(p, s, current, saved, candidates.get(0), slot);
        } catch (RuntimeException | SQLException e) {
            return unavailable("followup-evaluation-unavailable", saved);
        }
    }

    /** No second offer yet: the allocator's latest completed run for this brief says waiting or no-match. */
    private OfferOutcome awaiting(Principal p, State s, JsonNode current, ObjectNode saved) throws SQLException {
        Object[] latest;
        try (Connection c = sources.get().getConnection()) {
            latest = OfferDecisions.one(c, "SELECT r.evaluated_at, e.evaluation::text FROM allocation_runs r JOIN allocation_evaluations e "
                    + "ON e.environment_id = r.environment_id AND e.run_id = r.run_id AND e.allocation_id = r.allocation_id "
                    + "WHERE r.environment_id = ? AND r.run_id = ? AND r.state = 'completed' AND r.evaluated_at <= ? "
                    + "AND e.employee_id = ? AND e.evaluation->'versions'->>'brief' = ? "
                    + "ORDER BY r.evaluated_at DESC, r.allocation_id DESC LIMIT 1",
                    rs -> new Object[] {OfferDecisions.instant(rs, 1), rs.getString(2)},
                    p.environmentId(), p.runId(), s.now(), p.employeeId(), current.get("briefVersion").asText());
        }
        ObjectNode value = F.objectNode();
        value.put("schemaVersion", 1);
        value.put("decisionId", s.decision().decisionId());
        value.set("savedChange", saved);
        if (latest == null) return OfferOutcome.ok(value.put("state", "waiting"));
        JsonNode decisions;
        try {
            decisions = new com.fasterxml.jackson.databind.ObjectMapper().readTree((String) latest[1]).path("decisions");
        } catch (java.io.IOException e) {
            return unavailable("followup-evaluation-unavailable", saved);
        }
        if (!decisions.isArray()) return unavailable("followup-evaluation-unavailable", saved);
        for (JsonNode d : decisions) if ("eligible".equals(d.path("gateStatus").asText())) return OfferOutcome.ok(value.put("state", "waiting"));
        value.put("state", "no-match");
        value.putObject("evaluation").put("evaluatedAt", PolicyClock.iso((Instant) latest[0]))
                .put("carsChecked", decisions.size()).put("suitable", 0);
        return OfferOutcome.ok(value);
    }

    private OfferOutcome ready(Principal p, State s, JsonNode current, ObjectNode saved, String nextId, String slot) {
        OfferOutcome no = unavailable("followup-comparison-unavailable", saved);
        try {
            long version = current.get("briefVersion").longValue();
            var previousView = access.ownedView(p, s.decision().offerId());
            var nextView = access.ownedView(p, nextId);
            if (previousView.isEmpty() || nextView.isEmpty() || !"declined".equals(previousView.get().state())
                    || !"pending".equals(nextView.get().state())) return no;
            JsonNode previousQuote;
            JsonNode nextQuote;
            String previousNumber;
            String nextNumber;
            String clockVersion;
            String previousSlot;
            String nextSlot;
            try (Connection c = sources.get().getConnection()) {
                Object[] a = quote(c, p, previousView.get().quote().quoteId());
                Object[] b = quote(c, p, nextView.get().quote().quoteId());
                String holdSlot = OfferDecisions.one(c, "SELECT slot_id FROM custody_holds h JOIN buddy_offers o ON o.environment_id = h.environment_id "
                        + "AND o.run_id = h.run_id AND o.hold_id = h.hold_id WHERE o.environment_id = ? AND o.run_id = ? "
                        + "AND o.offer_id = ? AND h.state = 'active' AND h.hold_type = 'buddy-offer' AND h.employee_id = ?",
                        rs -> rs.getString(1), p.environmentId(), p.runId(), nextId, p.employeeId());
                Long clock = OfferDecisions.one(c, "SELECT clock_version FROM run_clocks WHERE environment_id = ? AND run_id = ?",
                        rs -> rs.getLong(1), p.environmentId(), p.runId());
                if (a == null || b == null || !slot.equals(holdSlot) || clock == null) return no;
                previousQuote = (JsonNode) a[0];
                previousNumber = (String) a[1];
                nextQuote = (JsonNode) b[0];
                nextNumber = (String) b[1];
                previousSlot = (String) a[3];
                nextSlot = (String) b[3];
                clockVersion = Long.toString(clock);
                Instant quoted = nextView.get().quote().quotedAt();
                // quotedAt is run time, confirmedAt wall time, so only the pinned brief version ties the quote to the brief.
                if (!(Boolean) a[2] || !(Boolean) b[2] || quoted == null || quoted.isAfter(s.now())) return no;
            }
            ObjectNode previous = FollowupComparison.offer(previousView.get(), p.runId(), clockVersion, s.decision().decisionId(),
                    previousQuote, previousNumber, new CurrentCarComparison.Owner(p.environmentId(), p.runId(), p.employeeId(), previousSlot));
            ObjectNode next = FollowupComparison.offer(nextView.get(), p.runId(), clockVersion, null, nextQuote, nextNumber,
                    new CurrentCarComparison.Owner(p.environmentId(), p.runId(), p.employeeId(), nextSlot));
            JsonNode config = assumption(p, s.now(), BriefAssumptions.RECOMMENDATION).path("value");
            if (previous == null || next == null) return no;
            ObjectNode comparison = FollowupComparison.build(previous, next, current, config);
            if (comparison == null || !(s.service().history(s.scope()) instanceof BriefResult.Ok ok)
                    || ok.value().get("versions").get(ok.value().get("versions").size() - 1).get("briefVersion").longValue() != version) {
                return no;
            }
            ObjectNode value = F.objectNode();
            value.put("schemaVersion", 1).put("state", "ready").put("decisionId", s.decision().decisionId());
            value.set("savedChange", saved);
            value.set("comparison", comparison);
            return OfferOutcome.ok(value);
        } catch (RuntimeException | SQLException e) {
            return no;
        }
    }

    /** The pinned quote json and the car's order number, with whether the quote belongs to this employee. */
    private static Object[] quote(Connection c, Principal p, String quoteId) throws SQLException {
        return OfferDecisions.one(c, "SELECT q.quote::text, k.attributes->>'orderNumber', q.employee_id = ?, q.slot_id FROM buddy_quotes q "
                + "JOIN stock_cars k ON k.environment_id = q.environment_id AND k.run_id = q.run_id AND k.order_uuid = q.order_uuid "
                + "WHERE q.environment_id = ? AND q.run_id = ? AND q.quote_id = ?", rs -> {
                    try {
                        return new Object[] {new com.fasterxml.jackson.databind.ObjectMapper().readTree(rs.getString(1)),
                            rs.getString(2), rs.getBoolean(3), rs.getString(4)};
                    } catch (java.io.IOException e) {
                        throw new SQLException("Stored quote is unreadable");
                    }
                }, p.employeeId(), p.environmentId(), p.runId(), quoteId);
    }

    private static OfferOutcome unavailable(String code, ObjectNode saved) {
        return OfferOutcome.of(503, "unavailable", code, "The offer follow-up is temporarily unavailable.", true)
                .withSavedChange(saved);
    }

    // ---- ownership and state ----

    private State prepare(Principal p, String decisionId) throws SQLException {
        if (!persistence.active()) throw new Stop(unavailable());
        Decision d;
        try (Connection c = sources.get().getConnection()) {
            d = OfferDecisions.one(c, "SELECT employee_id, decision, reason_code, reason->>'policyVersion', offer_id FROM offer_decisions "
                    + "WHERE environment_id = ? AND run_id = ? AND decision_id = ?",
                    rs -> new Decision(decisionId, rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5)),
                    p.environmentId(), p.runId(), decisionId);
        }
        if (d == null) {
            throw new Stop(OfferOutcome.of(404, "not-found", "offer-followup-not-found", "No decline was found for this follow-up.", false));
        }
        if (!p.employeeId().equals(d.employeeId()) || !"decline".equals(d.decision())) {
            throw new Stop(OfferOutcome.forbidden("offer-followup-not-owned", "Sign in as the employee who declined this offer."));
        }
        if (d.reasonCode() == null || !p.policyVersion().equals(d.reasonPolicy())) throw new Stop(unavailable());
        BriefService service = briefs.service().orElseThrow(() -> new Stop(unavailable()));
        BriefScope scope = new BriefScope(p.environmentId(), p.runId(), p.employeeId(), p.subject(), p.policyVersion());
        if (!(service.history(scope) instanceof BriefResult.Ok ok) || !ok.value().path("versions").isArray()
                || ok.value().get("versions").isEmpty()) {
            throw new Stop(unavailable());
        }
        Instant now = clock.now(new gcsp.api.persistence.RunContext(p.environmentId(), p.runId(), p.subject()));
        if (now == null) throw new Stop(unavailable());
        return new State(d, service, scope, (ArrayNode) ok.value().get("versions"), now);
    }

    // ---- the question ----

    private Question question(Principal p, State s, JsonNode brief) {
        JsonNode row = assumption(p, s.now(), KEY);
        JsonNode definition = null;
        for (JsonNode q : row.path("value").path("questions")) {
            if (s.decision().reasonCode().equals(q.path("reasonCode").asText(null))) definition = q;
        }
        if (definition == null) throw new Stop(unavailable());
        String path = definition.path("path").asText("");
        var m = PATH.matcher(path);
        String prompt = definition.path("prompt").asText("");
        if (!m.matches() || prompt.isBlank() || prompt.length() > 240 || !definition.path("control").isObject()) {
            throw new Stop(unavailable());
        }
        String section = m.group(1) != null ? m.group(1) : m.group(3);
        String key = m.group(2) != null ? m.group(2) : m.group(4);
        JsonNode target = brief.path(section).get(key);
        JsonNode current = target == null || target.get("value") == null ? F.nullNode() : target.get("value");
        ObjectNode control = definition.get("control").deepCopy();
        String kind = control.path("kind").asText("");
        if ("slider".equals(kind)) {
            control.set("minimum", assumption(p, s.now(), BriefAssumptions.SLIDER_MINIMUM).get("value"));
            control.set("maximum", assumption(p, s.now(), BriefAssumptions.SLIDER_MAXIMUM).get("value"));
        } else if (!"options".equals(kind) && !"equipment".equals(kind)) {
            throw new Stop(unavailable());
        }
        ObjectNode digest = F.objectNode();
        digest.put("policyVersion", p.policyVersion());
        digest.set("definition", definition);
        digest.put("briefVersion", brief.get("briefVersion").longValue());
        digest.set("currentValue", current);
        digest.put("decisionId", s.decision().decisionId());
        ObjectNode view = F.objectNode();
        view.put("schemaVersion", 1);
        view.put("reasonCode", s.decision().reasonCode());
        view.put("path", path);
        view.put("prompt", prompt);
        view.set("control", control);
        view.set("currentValue", current.deepCopy());
        view.put("policyVersion", p.policyVersion());
        view.put("questionVersion", Canonical.digest(digest));
        ObjectNode provenance = view.putObject("provenance");
        provenance.put("key", KEY);
        for (String field : new String[] {"status", "basis", "source", "sourceDate"}) {
            if (!row.path(field).isTextual() || row.get(field).textValue().isBlank()) throw new Stop(unavailable());
            provenance.set(field, row.get(field));
        }
        return new Question(view, kind, control, path, current, target);
    }

    private JsonNode assumption(Principal p, Instant now, String key) {
        PolicyResult r = policy.getAssumption(key, new PolicyRead(p.runId(), PolicyClock.iso(now), p.policyVersion()));
        if (!r.ok() || !p.policyVersion().equals(r.policyVersion()) || r.value() == null) throw new Stop(unavailable());
        return r.value();
    }

    /** The value BriefService saves for this answer, or null when the answer does not fit the question. */
    private static JsonNode changeValue(Question q, JsonNode value) {
        JsonNode control = q.control();
        switch (q.kind()) {
            case "options" -> {
                if (value == null || !value.isTextual()) return null;
                boolean listed = false;
                for (JsonNode o : control.path("options")) if (o.path("value").equals(value)) listed = true;
                return listed && !sameChoice(value, q.current()) ? value : null;
            }
            case "slider" -> {
                if (value == null || !value.isIntegralNumber() || !value.canConvertToLong()) return null;
                long v = value.longValue();
                boolean inRange = v >= control.path("minimum").asLong() && v <= control.path("maximum").asLong();
                return inRange && !value.equals(q.current()) ? value : null;
            }
            default -> {
                int items = control.path("maximumItems").asInt();
                int length = control.path("maximumItemLength").asInt();
                boolean adding = q.current().isNull();
                if (value == null || !value.isArray() || value.size() > items || adding && value.isEmpty()) return null;
                Set<String> seen = new HashSet<>();
                for (JsonNode item : value) {
                    if (!item.isTextual() || item.textValue().isBlank() || !item.textValue().equals(item.textValue().strip())
                            || item.textValue().length() > length || !seen.add(item.textValue())) return null;
                }
                if (!adding && seen.equals(asSet(q.current()))) return null;
                ObjectNode essential = F.objectNode();
                essential.put("operator", q.target() == null ? "includes" : q.target().path("operator").asText("includes"));
                essential.put("unit", q.target() == null ? "equipment-key" : q.target().path("unit").asText("equipment-key"));
                essential.put("state", "confirmed").put("source", "employee");
                essential.set("value", value);
                return essential;
            }
        }
    }

    private static boolean sameChoice(JsonNode a, JsonNode b) {
        return asSet(a).equals(asSet(b));
    }

    private static Set<String> asSet(JsonNode n) {
        Set<String> out = new HashSet<>();
        if (n == null || n.isNull()) return out;
        if (n.isArray()) n.forEach(x -> out.add(x.asText()));
        else out.add(n.asText());
        return out;
    }

    // ---- the saved change ----

    private static ObjectNode waiting(String decisionId, JsonNode brief) {
        ObjectNode value = F.objectNode();
        value.put("schemaVersion", 1);
        value.put("state", "waiting");
        value.put("decisionId", decisionId);
        value.set("savedChange", savedChange(decisionId, brief));
        return value;
    }

    private static ObjectNode savedChange(String decisionId, JsonNode brief) {
        JsonNode change = brief.get("postDeclineChange");
        long version = brief.get("briefVersion").longValue();
        String at = OffsetDateTime.parse(brief.get("confirmedAt").textValue()).toInstant().toString();
        ObjectNode value = F.objectNode();
        value.put("schemaVersion", 1);
        value.put("state", "change-saved");
        value.put("decisionId", decisionId);
        value.put("briefVersion", version);
        value.put("policyVersion", brief.get("policyVersion").textValue());
        ObjectNode ref = F.objectNode();
        ref.put("consumerId", "brief:changes");
        ref.put("decisionId", decisionId);
        ref.put("briefVersion", version);
        ObjectNode event = value.putObject("event");
        event.put("receiptReference", "brief-change:" + Canonical.digest(ref));
        event.put("eventType", "brief-changed");
        event.put("briefVersion", version);
        event.put("occurredAt", at);
        ObjectNode out = value.putObject("change");
        out.set("path", change.get("path"));
        out.set("before", change.get("before"));
        out.set("after", change.get("after"));
        return value;
    }

    private static OfferOutcome refusal(BriefResult.Refusal r) {
        return switch (r.httpStatus()) {
            case 400 -> invalid();
            case 403 -> OfferOutcome.forbidden("offer-followup-not-owned", "Sign in as the employee who declined this offer.");
            case 404 -> OfferOutcome.of(404, "not-found", "offer-followup-not-found", "No decline was found for this follow-up.", false);
            case 409 -> OfferOutcome.of(409, "conflict", r.code(), "This follow-up has changed. Reload it.", false);
            default -> unavailable();
        };
    }

    private static OfferOutcome stale(long expected, long current) {
        return OfferOutcome.of(409, "conflict", "stale-version",
                "Your brief changed (version " + current + ", not " + expected + "). Reload the question.", false);
    }

    private static boolean validConfirm(JsonNode b) {
        if (b == null || !b.isObject() || b.size() != CONFIRM_KEYS.size()) return false;
        for (String name : (Iterable<String>) b::fieldNames) if (!CONFIRM_KEYS.contains(name)) return false;
        return text(b.get("commandId")) && text(b.get("decisionId")) && text(b.get("questionVersion"))
                && b.get("expectedBriefVersion").isIntegralNumber() && b.get("expectedBriefVersion").canConvertToLong()
                && b.get("expectedBriefVersion").longValue() > 0;
    }

    static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank() && n.textValue().length() <= 128;
    }

    static OfferOutcome invalid() {
        return OfferOutcome.invalid("invalid-offer-followup", "Use the current follow-up question and confirm one different value.");
    }

    static OfferOutcome unavailable() {
        return OfferOutcome.of(503, "unavailable", "offer-followup-unavailable",
                "The offer follow-up is temporarily unavailable.", true);
    }

    private static String sha256(String s) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
