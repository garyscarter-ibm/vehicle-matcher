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
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The post-decline follow-up: the registered question for the declined reason, and the one confirmed brief change that
 * answers it (saved through BriefService). Supports question and waiting; ready and no-match need a comparison read.
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
    BriefServiceHolder briefs;

    /** Carries the typed answer out of a deep helper; anything unexpected becomes the unavailable answer. */
    private static final class Stop extends RuntimeException {
        final OfferOutcome outcome;

        Stop(OfferOutcome outcome) {
            super(null, null, false, false);
            this.outcome = outcome;
        }
    }

    private record Decision(String decisionId, String employeeId, String decision, String reasonCode, String reasonPolicy) {}

    private record State(Decision decision, BriefService service, BriefScope scope, ArrayNode history, Instant now) {}

    /** The question as shown, with the pieces the confirm needs to check an answer against it. */
    private record Question(ObjectNode view, String kind, JsonNode control, String path, JsonNode current, JsonNode target) {}

    public OfferOutcome read(Principal p, String decisionId) {
        try {
            State s = prepare(p, decisionId);
            for (JsonNode row : s.history()) {
                if (decisionId.equals(row.path("postDeclineChange").path("decisionId").asText(null))) {
                    return OfferOutcome.ok(waiting(decisionId, row));
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

    // ---- ownership and state ----

    private State prepare(Principal p, String decisionId) throws SQLException {
        if (!persistence.active()) throw new Stop(unavailable());
        Decision d;
        try (Connection c = sources.get().getConnection()) {
            d = OfferDecisions.one(c, "SELECT employee_id, decision, reason_code, reason->>'policyVersion' FROM offer_decisions "
                    + "WHERE environment_id = ? AND run_id = ? AND decision_id = ?",
                    rs -> new Decision(decisionId, rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)),
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
