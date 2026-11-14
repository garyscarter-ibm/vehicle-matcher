package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyVersion.Cell;
import gcsp.api.policy.PolicyVersion.Compiled;
import gcsp.api.policy.PolicyVersion.Row;
import gcsp.api.policy.PolicyVersion.Scheme;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.OptionalLong;

/**
 * Typed reads of the canonical, versioned policy (eligibility, allowance, points, assumptions), matching the Node
 * PolicyService read methods. Outcomes carry the resolved policy version and explicit failures.
 */
@ApplicationScoped
public class PolicyService {

    public static final String CONTRACT_VERSION = "1.0.0";
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    /** The validated form of one source answer, matched by identity so an unchanged answer is validated once. */
    private record Snapshot(List<JsonNode> supplied, List<PolicyVersion> versions) {
    }

    /** A resolved read: the version, its instant and the row selection rule. */
    private record Resolved(PolicyVersion version, long at, boolean pinned) {

        List<Row> rows(String table) {
            return version.rows(table, at, pinned);
        }
    }

    private final PolicySource source;
    private volatile Snapshot last;

    @Inject
    public PolicyService(PolicySource source) {
        this.source = source;
    }

    private static boolean text(String value) {
        return PolicyTime.text(value);
    }

    private static ObjectNode outcome(String status, String policyVersion, ObjectNode fields) {
        ObjectNode body = JSON.objectNode();
        body.put("status", status);
        body.setAll(fields);
        body.put("contractVersion", CONTRACT_VERSION);
        if (policyVersion == null) {
            body.putNull("policyVersion");
        } else {
            body.put("policyVersion", policyVersion);
        }
        return body;
    }

    private static PolicyResult result(String status, String policyVersion, ObjectNode fields) {
        return new PolicyResult(status, policyVersion, outcome(status, policyVersion, fields));
    }

    private static PolicyResult failure(String status, String policyVersion, String code, String field, String reason) {
        ObjectNode fields = JSON.objectNode();
        fields.put("code", code);
        ArrayNode reasons = fields.putArray("reasons");
        reasons.addObject().put("field", field).put("reason", reason);
        return result(status, policyVersion, fields);
    }

    private static PolicyResult invalid(String policyVersion, String code, String field, String reason) {
        return failure("invalid", policyVersion, code, field, reason);
    }

    private static PolicyResult ok(String policyVersion, JsonNode value) {
        ObjectNode fields = JSON.objectNode();
        fields.set("value", value.deepCopy());
        return result("ok", policyVersion, fields);
    }

    private static PolicyResult sourceFailure(PolicySourceException error) {
        boolean invalid = PolicySourceException.INVALID.equals(error.code());
        ObjectNode fields = JSON.objectNode();
        fields.put("code", invalid ? PolicySourceException.INVALID : PolicySourceException.UNAVAILABLE);
        if (!invalid) {
            fields.put("reason", "The policy source is unavailable.");
            fields.put("retryable", true);
        }
        fields.putArray("reasons").addObject().put("field", "source")
                .put("reason", "The policy source could not be loaded and validated.");
        return result(invalid ? "invalid" : "unavailable", null, fields);
    }

    private List<PolicyVersion> loadVersions(String runId) throws PolicySourceException {
        List<JsonNode> supplied = source.loadVersions(runId);
        Snapshot cached = last;
        if (cached != null && cached.supplied() == supplied) {
            return cached.versions();
        }
        List<PolicyVersion> versions = PolicyValidation.snapshot(supplied);
        last = new Snapshot(supplied, versions);
        return versions;
    }

    /** Either the resolved version or the failure outcome (exactly one is non-null). */
    private record Resolution(Resolved resolved, PolicyResult error) {
    }

    private Resolution resolve(PolicyRead read) {
        OptionalLong instant = read == null ? OptionalLong.empty() : PolicyTime.parse(read.asOf());
        if (read == null || !text(read.runId()) || instant.isEmpty()
                || (read.policyVersion() != null && !text(read.policyVersion()))) {
            return new Resolution(null, invalid(null, "invalid-read", "read",
                    "Supply runId, ISO asOf and an optional nonempty policyVersion."));
        }
        List<PolicyVersion> versions;
        try {
            versions = loadVersions(read.runId());
        } catch (PolicySourceException e) {
            return new Resolution(null, sourceFailure(e));
        } catch (RuntimeException e) {
            return new Resolution(null, sourceFailure(new PolicySourceException(PolicySourceException.UNAVAILABLE)));
        }
        boolean pinned = read.policyVersion() != null;
        PolicyVersion seed;
        if (pinned) {
            seed = versions.stream().filter(v -> v.policyVersion.equals(read.policyVersion())).findFirst().orElse(null);
        } else {
            long at = instant.getAsLong();
            seed = versions.stream().filter(v -> v.activeAt(at))
                    .max(Comparator.comparingLong((PolicyVersion v) -> v.from)).orElse(null);
        }
        if (seed == null) {
            ObjectNode fields = JSON.objectNode();
            fields.put("code", "policy-version-not-found");
            fields.put("resourceType", "policy-version");
            fields.putArray("reasons").addObject().put("field", "policyVersion")
                    .put("reason", "No matching retained policy version.");
            return new Resolution(null, result("not-found", null, fields));
        }
        // A pin preserves the rows effective when that immutable version began, including after their expiry.
        return new Resolution(new Resolved(seed, pinned ? seed.from : instant.getAsLong(), pinned), null);
    }

    private PolicyResult checkContext(PolicyContext context, PolicyRead read, Resolved resolved) {
        String version = resolved.version().policyVersion;
        if (context == null) {
            return invalid(version, "invalid-context", "context", "Supply a company, scheme and grade.");
        }
        if (context.runId() != null && !context.runId().equals(read.runId())) {
            return invalid(version, "run-mismatch", "runId", "Context and policy read must use the same run.");
        }
        Row mapping = find(resolved.rows("assumptions"), "key", "eligibility.context.mapping");
        if (mapping == null) {
            return invalid(version, "policy-configuration-unavailable", "eligibility.context.mapping",
                    "The context mapping is not effective.");
        }
        JsonNode scheme = null;
        for (JsonNode candidate : mapping.node().get("value")) {
            if (candidate.get("schemeId").textValue().equals(context.schemeId())) {
                scheme = candidate;
                break;
            }
        }
        if (scheme == null) {
            return invalid(version, "unknown-scheme", "schemeId", "Unknown scheme.");
        }
        if (!scheme.get("companyId").textValue().equals(context.companyId())) {
            return invalid(version, "unknown-company", "companyId", "Company is not mapped to this scheme.");
        }
        boolean graded = false;
        for (JsonNode grade : scheme.get("gradeIds")) {
            graded |= grade.textValue().equals(context.gradeId());
        }
        return graded ? null
                : invalid(version, "unknown-grade", "gradeId", "Grade is not mapped to this scheme.");
    }

    private static Row find(List<Row> rows, String field, String value) {
        for (Row row : rows) {
            if (value != null && value.equals(row.text(field))) {
                return row;
            }
        }
        return null;
    }

    /** Trusted server composition only; never serialize this seed through an HTTP route. */
    public PolicyResult getPolicySnapshot(PolicyRead read) {
        Resolution r = resolve(read);
        return r.error() != null ? r.error() : ok(r.resolved().version().policyVersion, r.resolved().version().seed);
    }

    public PolicyResult getActiveVersion(PolicyRead read) {
        Resolution r = resolve(read);
        if (r.error() != null) {
            return r.error();
        }
        ObjectNode seed = r.resolved().version().seed;
        ObjectNode value = JSON.objectNode();
        value.set("policyVersion", seed.get("policyVersion"));
        value.set("effectiveFrom", seed.get("effectiveFrom"));
        if (seed.has("effectiveTo")) {
            value.set("effectiveTo", seed.get("effectiveTo"));
        }
        value.set("source", seed.get("source"));
        return ok(r.resolved().version().policyVersion, value);
    }

    public PolicyResult getAssumption(String key, PolicyRead read) {
        Resolution r = resolve(read);
        if (r.error() != null) {
            return r.error();
        }
        Row row = find(r.resolved().rows("assumptions"), "key", key);
        String version = r.resolved().version().policyVersion;
        return row != null ? ok(version, row.node())
                : invalid(version, "unknown-assumption", "key", "Unknown or ineffective assumption key.");
    }

    public PolicyResult getAllowance(PolicyContext context, PolicyRead read) {
        Resolution r = resolve(read);
        if (r.error() != null) {
            return r.error();
        }
        PolicyResult error = checkContext(context, read, r.resolved());
        if (error != null) {
            return error;
        }
        String version = r.resolved().version().policyVersion;
        for (Row row : r.resolved().rows("allowances")) {
            if (context.companyId().equals(row.text("companyId")) && context.schemeId().equals(row.text("schemeId"))
                    && context.gradeId().equals(row.text("gradeId"))) {
                return ok(version, row.node());
            }
        }
        return failure("not-found", version, "allowance-not-found", "allowance",
                "No effective allowance for this context.", "allowance");
    }

    public PolicyResult getPointsCost(PolicyContext context, JsonNode car, PolicyRead read) {
        Resolution r = resolve(read);
        if (r.error() != null) {
            return r.error();
        }
        PolicyResult error = checkContext(context, read, r.resolved());
        if (error != null) {
            return error;
        }
        String version = r.resolved().version().policyVersion;
        List<Row> matches = new ArrayList<>();
        for (Row row : r.resolved().rows("pricePlans")) {
            if (context.schemeId().equals(row.text("schemeId")) && priceMatches(row, car)) {
                matches.add(row);
            }
        }
        if (matches.size() > 1) {
            return invalid(version, "ambiguous-price", "car", "Multiple effective prices match the supplied car facts.");
        }
        return matches.isEmpty()
                ? failure("not-found", version, "price-not-found", "car",
                        "No exact effective monthly points price.", "price")
                : ok(version, matches.get(0).node());
    }

    private static boolean priceMatches(Row row, JsonNode car) {
        if (car == null || !car.isObject()) {
            return false;
        }
        String configuration = row.text("configurationId");
        return configuration != null ? textFact(car, "configurationId", configuration)
                : textFact(car, row.text("matchField"), row.text("matchValue"));
    }

    private static boolean textFact(JsonNode car, String field, String expected) {
        JsonNode fact = field == null ? null : car.get(field);
        return fact != null && fact.isTextual() && fact.textValue().equals(expected);
    }

    private static PolicyResult failure(String status, String version, String code, String field, String reason,
            String resourceType) {
        ObjectNode fields = JSON.objectNode();
        fields.put("code", code);
        fields.put("resourceType", resourceType);
        fields.putArray("reasons").addObject().put("field", field).put("reason", reason);
        return result(status, version, fields);
    }

    public PolicyResult getEligibility(PolicyContext context, JsonNode car, PolicyRead read) {
        Resolution r = resolve(read);
        if (r.error() != null) {
            return r.error();
        }
        Resolved resolved = r.resolved();
        PolicyResult error = checkContext(context, read, resolved);
        if (error != null) {
            return error;
        }
        String version = resolved.version().policyVersion;
        Compiled compiled = resolved.version().eligibility(resolved.at(), resolved.pinned());
        Row field = compiled.field();
        Row precedence = compiled.precedence();
        JsonNode fieldValue = field == null ? null : field.node().get("value");
        JsonNode precedenceValue = precedence == null ? null : precedence.node().get("value");
        if (fieldValue == null || !fieldValue.isTextual() || !text(fieldValue.textValue()) || precedenceValue == null
                || !precedenceValue.isTextual() || !"excludeThenInclude".equals(precedenceValue.textValue())) {
            return invalid(version, "unsupported-rule-selection", "eligibility.rule",
                    "Unsupported or ineffective rule field/precedence selection.");
        }
        Scheme scheme = compiled.schemes().get(context.schemeId());
        if (scheme != null && scheme.unsupported) {
            return invalid(version, "unsupported-rule-selection", "eligibility.rule.matchField",
                    "The selected field does not match the scheme rules.");
        }
        JsonNode fact = car != null && car.isObject() ? car.get(fieldValue.textValue()) : null;
        String factText = fact != null && fact.isTextual() && text(fact.textValue()) ? fact.textValue() : null;
        Cell match = scheme == null || factText == null || !scheme.grades.containsKey(context.gradeId()) ? null
                : scheme.grades.get(context.gradeId()).get(factText);
        List<Row> rules = match == null ? List.of() : match.rules;
        boolean excluded = match != null && match.excluded;
        boolean eligible = !excluded && match != null && match.included;
        String state = excluded ? "ineligible" : eligible ? "eligible" : "needs-confirmation";
        ObjectNode value = JSON.objectNode();
        value.put("eligible", eligible);
        value.put("state", state);
        ArrayNode ruleIds = value.putArray("ruleIds");
        rules.forEach(rule -> ruleIds.add(rule.text("ruleId")));
        value.putArray("reasons").add(excluded ? "explicit-exclude" : eligible ? "explicit-include"
                : factText != null ? "no-applicable-include" : "missing-model-fact");
        ObjectNode provenance = value.putObject("provenance");
        copyInto(provenance.putArray("rules"), rules);
        copyInto(provenance.putArray("schemeRuleLinks"), match == null ? List.of() : match.links);
        ArrayNode assumptions = provenance.putArray("assumptions");
        assumptions.add(field.node().deepCopy());
        assumptions.add(precedence.node().deepCopy());
        assumptions.add(compiled.mapping() == null ? JSON.nullNode() : compiled.mapping().node().deepCopy());
        return ok(version, value);
    }

    private static void copyInto(ArrayNode target, List<Row> rows) {
        rows.forEach(row -> target.add(row.node().deepCopy()));
    }
}
