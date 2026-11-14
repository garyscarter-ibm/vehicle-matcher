package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** The scheme terms, approval stages and order reference format: dated PolicyService reads, validated, fail closed. */
public class OrderingTerms {

    public static final String TERMS_KEY = "ordering.terms.v1";
    public static final String STAGES_KEY = "ordering.approvalStages.v1";
    public static final String REFERENCE_KEY = "ordering.reference.v1";
    private static final List<List<String>> ALLOWED_STAGES = List.of(
            List.of("sales-manager approval", "sent to ordering"),
            List.of("HR approval", "sales-manager approval", "sent to ordering"));

    public sealed interface TermsRead {}

    /** value: the terms plus policyVersion, approvalStages and termsDigest (the digest of everything else). */
    public record TermsOk(ObjectNode value) implements TermsRead {}

    public record ReferenceFormat(String prefix, int digits, long first) {}

    public record Failed(String code) implements TermsRead, ReferenceRead {}

    public sealed interface ReferenceRead {}

    public record ReferenceOk(ReferenceFormat format) implements ReferenceRead {}

    private final PolicyService policy;
    private final PolicyClock clock;

    public OrderingTerms(PolicyService policy, PolicyClock clock) {
        this.policy = policy;
        this.clock = clock;
    }

    public Instant now(OrderingScope scope) {
        return clock.now(scope.context());
    }

    public TermsRead terms(OrderingScope scope, Instant now) {
        try {
            PolicyRead read = new PolicyRead(scope.runId(), PolicyClock.iso(now), scope.policyVersion());
            PolicyResult terms = policy.getAssumption(TERMS_KEY, read);
            PolicyResult stages = policy.getAssumption(STAGES_KEY, read);
            if (!usable(terms, scope) || !usable(stages, scope)) return new Failed("ordering-policy-unavailable");
            JsonNode t = terms.value().get("value");
            JsonNode s = stages.value().get("value");
            if (!validTerms(t, now) || !validStages(s)) return new Failed("ordering-policy-invalid");
            ObjectNode value = ((ObjectNode) t).deepCopy();
            value.put("policyVersion", scope.policyVersion());
            value.set("approvalStages", s.deepCopy());
            value.put("termsDigest", Canonical.digest(value));
            return new TermsOk(value);
        } catch (RuntimeException e) {
            return new Failed("ordering-policy-unavailable");
        }
    }

    public ReferenceRead reference(OrderingScope scope, Instant now) {
        try {
            PolicyResult r = policy.getAssumption(REFERENCE_KEY,
                    new PolicyRead(scope.runId(), PolicyClock.iso(now), scope.policyVersion()));
            if (!usable(r, scope)) return new Failed("order-reference-policy-unavailable");
            JsonNode f = r.value().get("value");
            if (f == null || !f.isObject() || f.path("schemaVersion").asInt() != 1 || !f.path("prefix").isTextual()
                    || !f.path("prefix").asText().matches("^[A-Za-z0-9-]{0,11}[A-Za-z-]$")
                    || !f.path("digits").canConvertToInt() || f.path("digits").asInt() < 1 || f.path("digits").asInt() > 12
                    || !f.path("first").canConvertToLong() || f.path("first").asLong() < 1) {
                return new Failed("order-reference-policy-invalid");
            }
            return new ReferenceOk(new ReferenceFormat(f.get("prefix").asText(), f.get("digits").asInt(), f.get("first").asLong()));
        } catch (RuntimeException e) {
            return new Failed("order-reference-policy-unavailable");
        }
    }

    private static boolean usable(PolicyResult r, OrderingScope scope) {
        return r.ok() && r.value() != null && r.value().isObject() && scope.policyVersion().equals(r.policyVersion());
    }

    private static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.asText().isBlank();
    }

    private static boolean validTerms(JsonNode t, Instant now) {
        if (t == null || !t.isObject() || t.path("schemaVersion").asInt() != 1 || !t.path("fictional").asBoolean(false)
                || !text(t.get("termsVersion")) || !text(t.get("wording")) || !validWordingByMode(t.get("wordingByMode"))
                || !text(t.get("validUntil"))) {
            return false;
        }
        try {
            if (!Instant.parse(t.get("validUntil").asText()).isAfter(now)) return false;
        } catch (java.time.format.DateTimeParseException e) {
            return false;
        }
        JsonNode d = t.get("declarations");
        if (d == null || !d.isArray() || d.isEmpty()) return false;
        Set<String> ids = new HashSet<>();
        for (JsonNode x : d) {
            if (!x.isObject() || !text(x.get("id")) || !text(x.get("label")) || !ids.add(x.get("id").asText())
                    || !List.of("all", "new", "replacement").contains(x.path("appliesTo").asText())) {
                return false;
            }
        }
        return true;
    }

    private static boolean validWordingByMode(JsonNode w) {
        if (w == null || w.isMissingNode()) return true;
        if (!w.isObject()) return false;
        for (var it = w.fields(); it.hasNext();) {
            var e = it.next();
            if (!List.of("new", "replacement").contains(e.getKey()) || !text(e.getValue())) return false;
        }
        return true;
    }

    private static boolean validStages(JsonNode s) {
        if (s == null || !s.isArray()) return false;
        List<String> names = new java.util.ArrayList<>();
        for (JsonNode x : s) names.add(x.isTextual() ? x.asText() : null);
        return ALLOWED_STAGES.contains(names);
    }
}
