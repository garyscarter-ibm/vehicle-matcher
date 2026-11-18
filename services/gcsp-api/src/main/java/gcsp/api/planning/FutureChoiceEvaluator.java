package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import gcsp.api.recommendation.BriefRules;
import gcsp.api.recommendation.Gates;
import gcsp.api.recommendation.PreferenceScoring;
import gcsp.api.recommendation.RecommendationConfig;
import gcsp.api.recommendation.Slider;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * Port of createFutureChoiceEvaluator (server/gcsp/predict/plan/future-choices.js): per catalogue configuration,
 * gates, policy and future terms for one employee and confirmed brief. A plain class, wired nowhere. Any throw maps
 * to planning-future-evaluation-unavailable, as in Node.
 */
public final class FutureChoiceEvaluator {

    private static final List<String> KEYS = List.of("employee.recommendation.v1", "brief.slider.minimum",
            "brief.slider.maximum", "brief.lifecycle.v1", "eligibility.homeCharging.requiredForPlugIn",
            "offer.declinedCar.exclusion");
    private static final List<String> STOCK_KEYS = List.of("orderUuid", "availability", "identityKind", "stockId", "vin");
    private static final List<String> ASSURANCES =
            List.of("unknown", "confirmed-listing", "confirmed-build", "model-reference", "derived", "synthetic-scenario");
    private static final Pattern STRICT_DATE =
            Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z");
    private static final Pattern CURRENCY = Pattern.compile("[A-Z]{3}");
    private static final List<String> LIMITATIONS = List.of(
            "All represented configurations must pass before a derivative-only quantity can promise coverage.",
            "Preference fit is advisory; no acceptance threshold or acceptance probability is inferred.",
            "Exact declined stock exclusions do not exclude other vehicles or future configurations of that derivative.");

    private final PolicyService policy;
    private final PolicyFutureTerms terms;

    public FutureChoiceEvaluator(PolicyService policy, PolicyFutureTerms terms) {
        this.policy = policy;
        this.terms = terms;
    }

    /** The typed outcome of Node evaluateChoices; the input is never mutated. */
    public ObjectNode evaluateChoices(Principal principal, JsonNode input) {
        if (policy == null || terms == null) {
            return Outcomes.unavailable("planning-future-evaluator-not-configured");
        }
        if (!OrderPlanService.greg(principal)) {
            return Outcomes.forbidden();
        }
        try {
            return evaluate(principal, input);
        } catch (RuntimeException e) {
            return Outcomes.unavailable("planning-future-evaluation-unavailable");
        }
    }

    private ObjectNode evaluate(Principal principal, JsonNode raw) {
        JsonNode in = raw.deepCopy();
        JsonNode read = Js.get(in, "read");
        JsonNode employee = Js.get(in, "employee");
        JsonNode brief = Js.get(in, "brief");
        JsonNode catalog = Js.get(in, "catalog");
        JsonNode history = Js.get(in, "history");
        if (employee == null || employee.isNull()) {
            throw new IllegalStateException("employee");
        }
        String renewalAt = PlanningRenewal.renewalInstant(employee);
        String runId = principal.runId();
        String policyVersion = principal.policyVersion();
        if (inputInvalid(read, employee, brief, runId, policyVersion, renewalAt)) {
            return Outcomes.unavailable("planning-future-input-invalid");
        }
        if (catalogInvalid(catalog, read, runId)) {
            return Outcomes.unavailable("planning-future-catalog-invalid");
        }
        String asOf = read.get("asOf").textValue();
        PolicyRead pin = new PolicyRead(runId, asOf, str(read.get("policyVersion")));
        List<PolicyResult> rows = new ArrayList<>();
        for (String key : KEYS) {
            rows.add(policy.getAssumption(key, pin));
        }
        for (int i = 0; i < rows.size(); i++) {
            PolicyResult row = rows.get(i);
            if (!"ok".equals(row.status()) || !Objects.equals(row.policyVersion(), policyVersion)
                    || !is(Js.get(row.value(), "key"), KEYS.get(i))) {
                return Outcomes.unavailable("planning-future-policy-unavailable");
            }
        }
        JsonNode config = Js.get(rows.get(0).value(), "value");
        JsonNode minimum = Js.get(rows.get(1).value(), "value");
        JsonNode maximum = Js.get(rows.get(2).value(), "value");
        JsonNode lifecycle = Js.get(rows.get(3).value(), "value");
        JsonNode charging = Js.get(rows.get(4).value(), "value");
        JsonNode decline = Js.get(rows.get(5).value(), "value");
        if (policyInvalid(config, minimum, maximum, lifecycle, charging, decline)) {
            return Outcomes.unavailable("planning-future-policy-invalid");
        }
        JsonNode configurations = catalog.get("configurations");
        for (JsonNode c : configurations) {
            if (!factsValid(c.get("facts"), config, asOf)) {
                return Outcomes.unavailable("planning-future-catalog-invalid");
            }
        }
        Slider slider = new Slider(0, 100);
        RecommendationConfig rc = new RecommendationConfig(config);
        ObjectNode merged = ((ObjectNode) config).deepCopy();
        ((ObjectNode) merged.get("essentials")).set("charging", lifecycle.get("charging").deepCopy());
        ObjectNode content = Outcomes.object();
        putIfPresent(content, "schemaVersion", brief.get("schemaVersion"));
        putIfPresent(content, "preferences", brief.get("preferences"));
        putIfPresent(content, "essentials", brief.get("essentials"));
        putIfPresent(content, "requiredBy", brief.get("requiredBy"));
        if (BriefRules.validateBriefContent(content, new RecommendationConfig(merged), slider).size() > 0) {
            return Outcomes.unavailable("planning-future-brief-invalid");
        }
        JsonNode facts0 = Js.get(Js.get(Js.get(employee, "contract"), "manualContext"), "employeeFacts");
        if (!Js.object(facts0)) {
            return Outcomes.unavailable("planning-future-employee-facts-unavailable");
        }
        ObjectNode employeeFacts = facts0.deepCopy();
        JsonNode employeeEssentials = employeeFacts.get("essentials");
        if (employeeEssentials != null) {
            ObjectNode check = Outcomes.object();
            check.put("schemaVersion", 1);
            check.putObject("preferences");
            check.set("essentials", employeeEssentials);
            if (BriefRules.validateBriefContent(check, rc, slider).size() > 0) {
                return Outcomes.unavailable("planning-future-employee-facts-invalid");
            }
        }
        boolean observedAtMissing = false;
        JsonNode supplied = Js.get(brief.get("essentials"), "charging");
        if (supplied != null && supplied.isObject() && !Gates.unselectedPracticalAnswer(supplied)) {
            JsonNode value = supplied.get("value");
            boolean known = is(supplied.get("state"), "confirmed") && !(value != null && value.isNull());
            ObjectNode fact = Outcomes.object();
            fact.put("status", known ? "known" : "unknown");
            putIfPresent(fact, "value", value);
            fact.putNull("unit");
            ObjectNode provenance = fact.putObject("provenance");
            provenance.put("sourceRef", "saved-brief");
            provenance.put("version", JsNum.str(brief.get("briefVersion").doubleValue()));
            observedAtMissing = brief.get("confirmedAt") == null;
            putIfPresent(provenance, "observedAt", brief.get("confirmedAt"));
            provenance.put("assurance", "synthetic-scenario");
            employeeFacts.set("charging", fact);
        }
        JsonNode stated = employeeFacts.get("requiredBy");
        boolean deadlineUnknown = stated != null && (!Gates.confirmedFact(stated, rc) || !instant(Js.get(stated, "value")));
        long earliest = JsTime.parse(renewalAt);
        if (!deadlineUnknown && stated != null) {
            earliest = Math.min(earliest, JsTime.parse(stated.get("value").textValue()));
        }
        JsonNode briefRequiredBy = brief.get("requiredBy");
        if (briefRequiredBy != null && briefRequiredBy.isTextual() && !briefRequiredBy.textValue().isEmpty()) {
            earliest = Math.min(earliest, JsTime.parse(briefRequiredBy.textValue()));
        }
        String requiredBy = JsTime.iso(earliest);
        ArrayNode excludedStockIds = excludedStock(history, brief);
        if (excludedStockIds == null) {
            return Outcomes.unavailable("planning-future-decline-history-incomplete");
        }
        PolicyContext employeeContext = new PolicyContext(runId, employee.get("companyId").textValue(),
                employee.get("schemeId").textValue(), employee.get("gradeId").textValue());
        PolicyResult allowance = policy.getAllowance(employeeContext, pin);
        if (!"ok".equals(allowance.status()) || !Objects.equals(allowance.policyVersion(), policyVersion)) {
            return Outcomes.unavailable("planning-future-policy-unavailable");
        }
        RunContext runContext = new RunContext(principal.environmentId(), runId, principal.subject());
        PlanningRead planningRead = new PlanningRead(runContext, asOf, str(read.get("policyVersion")),
                read.get("horizonEnd").textValue());
        ArrayNode decisions = Outcomes.array();
        ArrayNode termVersions = Outcomes.array();
        List<JsonNode> ordered = new ArrayList<>(Js.items(configurations));
        ordered.sort((a, b) -> a.get("configurationId").textValue().compareTo(b.get("configurationId").textValue()));
        boolean plugInRequired = charging.booleanValue();
        for (JsonNode configuration : ordered) {
            ObjectNode snapshot = Outcomes.object();
            snapshot.set("display", configuration.get("display").deepCopy());
            snapshot.set("facts", configuration.get("facts").deepCopy());
            ObjectNode car = Outcomes.object();
            for (Iterator<Map.Entry<String, JsonNode>> it = configuration.get("facts").fields(); it.hasNext();) {
                Map.Entry<String, JsonNode> f = it.next();
                if (Gates.confirmedFact(f.getValue(), rc)) {
                    putIfPresent(car, f.getKey(), f.getValue().get("value"));
                }
            }
            car.set("configurationId", configuration.get("configurationId"));
            PolicyResult eligibility = policy.getEligibility(employeeContext, car, pin);
            PolicyResult points = policy.getPointsCost(employeeContext, car, pin);
            if (!"ok".equals(eligibility.status()) || !("ok".equals(points.status()) || "not-found".equals(points.status()))
                    || !Objects.equals(eligibility.policyVersion(), policyVersion)
                    || !Objects.equals(points.policyVersion(), policyVersion)) {
                return Outcomes.unavailable("planning-future-policy-unavailable");
            }
            ArrayNode blockers = Outcomes.array();
            ArrayNode unknowns = Outcomes.array();
            ArrayNode reasons = Outcomes.array();
            if (deadlineUnknown) {
                unknowns.add(code("required-by-unconfirmed"));
            }
            if (employeeEssentials == null) {
                unknowns.add(code("employee-essentials-unconfirmed"));
            }
            if (config.get("driverEligibilityRequired").booleanValue()) {
                JsonNode driver = employeeFacts.get("driverEligible");
                if (!Gates.confirmedFact(driver, rc) || !isBool(driver.get("value"))) {
                    unknowns.add(code("driver-unconfirmed"));
                } else if (driver.get("value").booleanValue()) {
                    reasons.add(code("driver-eligible"));
                } else {
                    blockers.add(code("driver-ineligible"));
                }
            }
            JsonNode eligible = eligibility.value();
            if (is(Js.get(eligible, "state"), "ineligible")) {
                ObjectNode b = code("policy-exclude");
                putIfPresent(b, "ruleIds", copy(eligible.get("ruleIds")));
                blockers.add(b);
            } else if (!is(Js.get(eligible, "state"), "eligible")) {
                ObjectNode u = code("eligibility-unconfirmed");
                putIfPresent(u, "reasons", copy(eligible.get("reasons")));
                unknowns.add(u);
            } else {
                ObjectNode r = code("policy-include");
                putIfPresent(r, "ruleIds", copy(eligible.get("ruleIds")));
                reasons.add(r);
            }
            ObjectNode futureTerms = null;
            if (!"ok".equals(points.status())) {
                unknowns.add(code("points-unavailable"));
            } else {
                ObjectNode request = Outcomes.object();
                request.set("employee", employee);
                request.set("brief", brief);
                request.set("catalogVersion", catalog.get("version"));
                request.set("configuration", configuration);
                ObjectNode provided = terms.readFutureTerms(runContext, planningRead, request);
                if (!Outcomes.isOk(provided)) {
                    return Outcomes.unavailable("planning-future-terms-unavailable");
                }
                JsonNode value = provided.get("value");
                if (!sameString(Js.get(value, "runId"), runId) || !is(value.get("asOf"), asOf)
                        || !sameString(value.get("policyVersion"), policyVersion)
                        || !eq(value.get("employeeId"), employee.get("employeeId"))
                        || !eq(value.get("renewalId"), employee.get("renewalId"))
                        || !eq(value.get("briefVersion"), brief.get("briefVersion"))
                        || !eq(value.get("catalogVersion"), catalog.get("version"))
                        || !eq(value.get("configurationId"), configuration.get("configurationId"))
                        || !Js.text(value.get("version"))) {
                    return Outcomes.unavailable("planning-future-terms-invalid");
                }
                try {
                    futureTerms = employeeTerms(value.get("terms"));
                } catch (RuntimeException e) {
                    return Outcomes.unavailable("planning-future-terms-invalid");
                }
                JsonNode pointsValue = points.value();
                JsonNode allowanceValue = allowance.value();
                JsonNode monthly = Js.get(pointsValue, "monthlyPoints");
                JsonNode allowed = Js.get(allowanceValue, "monthlyPoints");
                JsonNode termsAllowance = Js.get(Js.get(Js.get(futureTerms, "allowanceInputs"), "allowance"), "value");
                if (JsTime.parse(futureTerms.get("validFrom").textValue()) > JsTime.parse(asOf)
                        || JsTime.parse(futureTerms.get("validUntil").textValue()) <= JsTime.parse(renewalAt)
                        || !eq(futureTerms.get("points").get("value"), monthly) || !eq(termsAllowance, allowed)
                        || !includes(config.get("confirmedAssurances"), futureTerms.get("provenance").get("assurance"))) {
                    return Outcomes.unavailable("planning-future-terms-invalid");
                }
                termVersions.add(value.deepCopy());
                (gte(allowed, monthly) ? reasons : blockers).add(code(gte(allowed, monthly)
                        ? "allowance-sufficient" : "allowance-exceeded"));
            }
            ObjectNode essentials = Outcomes.object();
            Iterator<Map.Entry<String, JsonNode>> own = brief.get("essentials").fields();
            while (own.hasNext()) {
                Map.Entry<String, JsonNode> e = own.next();
                if (!e.getKey().equals("charging")) {
                    essentials.set(e.getKey(), e.getValue());
                }
            }
            ObjectNode own1 = Outcomes.object();
            own1.set("essentials", employeeEssentials == null ? Outcomes.object() : employeeEssentials);
            ObjectNode own2 = Outcomes.object();
            own2.set("essentials", essentials);
            for (Gates.Result gate : List.of(Gates.evaluateEssentials(snapshot, own1, rc, false),
                    Gates.evaluateEssentials(snapshot, own2, rc, true),
                    Gates.chargingGates(snapshot, employeeFacts, rc, plugInRequired))) {
                blockers.addAll(gate.blockers());
                unknowns.addAll(gate.unknowns());
                reasons.addAll(gate.reasons());
            }
            if (JsTime.parse(requiredBy) < JsTime.parse(asOf)) {
                blockers.add(code(requiredBy.equals(renewalAt) ? "renewal-already-passed" : "required-by-already-passed"));
            }
            String gateStatus = blockers.size() > 0 ? "ineligible" : unknowns.size() > 0 ? "needs-confirmation" : "eligible";
            ObjectNode scored;
            if (gateStatus.equals("eligible")) {
                scored = PreferenceScoring.score(snapshot, brief, employeeFacts, rc, slider);
            } else {
                scored = Outcomes.object();
                scored.putNull("score");
                scored.putArray("components");
                scored.putArray("reasons");
                scored.putArray("tradeOffs");
                scored.putArray("unknowns");
            }
            ObjectNode decision = Outcomes.object();
            decision.set("configurationId", configuration.get("configurationId"));
            decision.set("derivativeId", configuration.get("derivativeId"));
            decision.put("gateStatus", gateStatus);
            decision.set("score", scored.get("score"));
            decision.set("components", scored.get("components"));
            decision.set("blockers", blockers);
            ArrayNode allUnknowns = Outcomes.array();
            allUnknowns.addAll(unknowns);
            allUnknowns.addAll((ArrayNode) scored.get("unknowns"));
            decision.set("unknowns", allUnknowns);
            ArrayNode allReasons = Outcomes.array();
            allReasons.addAll(reasons);
            allReasons.addAll((ArrayNode) scored.get("reasons"));
            decision.set("reasons", allReasons);
            decision.set("tradeOffs", scored.get("tradeOffs"));
            if (futureTerms == null) {
                decision.putNull("terms");
            } else {
                decision.set("terms", futureTerms);
            }
            ObjectNode evidence = decision.putObject("evidence");
            evidence.set("eligibility", copy(eligible));
            JsonNode pointsOut = points.value();
            if (pointsOut == null) {
                evidence.putNull("points");
            } else {
                evidence.set("points", pointsOut.deepCopy());
            }
            evidence.set("allowance", copy(allowance.value()));
            evidence.set("factsVersion", configuration.get("version"));
            decisions.add(decision);
        }
        Set<String> gates = new TreeSet<>();
        for (JsonNode d : decisions) {
            for (String list : List.of("blockers", "unknowns")) {
                for (JsonNode g : d.get(list)) {
                    gates.add(g.get("code").textValue());
                }
            }
        }
        List<String> acceptable = new ArrayList<>();
        for (JsonNode derivative : catalog.get("derivatives")) {
            boolean every = true;
            for (JsonNode d : decisions) {
                if (includes(derivative.get("configurationIds"), d.get("configurationId")) && !is(d.get("gateStatus"), "eligible")) {
                    every = false;
                }
            }
            if (every) {
                acceptable.add(derivative.get("derivativeId").textValue());
            } else {
                gates.add("derivative-representation-not-fully-eligible:" + derivative.get("derivativeId").textValue());
            }
        }
        if (!OrderPlanService.greg(principal)) {
            return Outcomes.forbidden();
        }
        if (observedAtMissing && mentionsSavedBrief(decisions)) {
            throw new IllegalStateException("Digest input must be JSON data");
        }
        ObjectNode digest = Outcomes.object();
        digest.set("input", raw);
        ArrayNode policyRows = digest.putArray("policy");
        rows.forEach(r -> policyRows.add(r.body()));
        digest.set("allowance", allowance.body());
        digest.set("decisions", decisions);
        digest.set("termVersions", termVersions);
        ObjectNode value = Outcomes.object();
        value.put("runId", runId);
        value.put("policyVersion", policyVersion);
        value.set("employeeId", employee.get("employeeId"));
        value.set("briefVersion", brief.get("briefVersion"));
        value.set("catalogVersion", catalog.get("version"));
        value.put("version", CanonicalJson.digest(digest));
        ArrayNode acceptableIds = value.putArray("acceptableDerivativeIds");
        acceptable.stream().sorted().forEach(acceptableIds::add);
        value.set("excludedStockIds", excludedStockIds);
        value.put("requiredBy", requiredBy);
        ArrayNode gateList = value.putArray("gates");
        gates.forEach(gateList::add);
        value.set("decisions", decisions);
        ArrayNode limitations = value.putArray("limitations");
        LIMITATIONS.forEach(limitations::add);
        return Outcomes.ok(value);
    }

    // ---- input and catalogue validation ----

    private static boolean inputInvalid(JsonNode read, JsonNode employee, JsonNode brief, String runId,
            String policyVersion, String renewalAt) {
        if (!sameString(Js.get(read, "runId"), runId) || !sameString(p(read, "policyVersion"), policyVersion)
                || !instant(p(read, "asOf")) || !instant(p(read, "horizonEnd"))
                || !sameString(Js.get(employee, "runId"), runId) || !sameString(Js.get(brief, "runId"), runId)
                || !eq(p(brief, "employeeId"), p(employee, "employeeId")) || !is(p(brief, "status"), "confirmed")
                || !Js.integer(p(brief, "briefVersion")) || p(brief, "briefVersion").doubleValue() == 0) {
            return true;
        }
        for (String k : List.of("employeeId", "companyId", "schemeId", "gradeId", "renewalId", "entitlementSlotId")) {
            if (!Js.text(p(employee, k))) {
                return true;
            }
        }
        JsonNode briefRenewal = p(brief, "renewalId");
        return briefRenewal != null && !briefRenewal.isNull() && !eq(briefRenewal, p(employee, "renewalId"))
                || !eq(p(brief, "entitlementSlotId"), p(employee, "entitlementSlotId")) || renewalAt == null
                || JsTime.parse(renewalAt) > JsTime.parse(read.get("horizonEnd").textValue());
    }

    private static boolean catalogInvalid(JsonNode catalog, JsonNode read, String runId) {
        if (!sameString(Js.get(catalog, "runId"), runId) || !eq(p(catalog, "asOf"), p(read, "asOf"))
                || !eq(p(catalog, "policyVersion"), p(read, "policyVersion")) || !Js.text(p(catalog, "version"))) {
            return true;
        }
        JsonNode derivatives = p(catalog, "derivatives");
        JsonNode configurations = p(catalog, "configurations");
        if (!Js.array(derivatives) || derivatives.size() == 0 || !Js.array(configurations) || configurations.size() > 256) {
            return true;
        }
        List<JsonNode> configurationIds = new ArrayList<>();
        for (JsonNode c : configurations) {
            configurationIds.add(p(c, "configurationId"));
        }
        List<JsonNode> derivativeIds = new ArrayList<>();
        for (JsonNode d : derivatives) {
            derivativeIds.add(p(d, "derivativeId"));
        }
        if (!Js.unique(configurationIds) || !Js.unique(derivativeIds)) {
            return true;
        }
        for (JsonNode d : derivatives) {
            JsonNode ids = p(d, "configurationIds");
            if (!Js.text(p(d, "derivativeId")) || !Js.array(ids) || ids.size() == 0 || !Js.everyText(ids)
                    || !Js.unique(Js.items(ids))) {
                return true;
            }
            for (JsonNode id : ids) {
                boolean found = false;
                for (JsonNode c : configurations) {
                    if (eq(p(c, "configurationId"), id) && eq(p(c, "derivativeId"), p(d, "derivativeId"))) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return true;
                }
            }
        }
        for (JsonNode c : configurations) {
            if (!Js.text(p(c, "configurationId")) || !Js.text(p(c, "version"))
                    || !Js.text(Js.get(p(c, "display"), "name"))) {
                return true;
            }
            for (String k : STOCK_KEYS) {
                if (Js.object(c) && c.has(k)) {
                    return true;
                }
            }
            boolean represented = false;
            for (JsonNode d : derivatives) {
                if (eq(p(d, "derivativeId"), p(c, "derivativeId")) && includes(p(d, "configurationIds"), p(c, "configurationId"))) {
                    represented = true;
                    break;
                }
            }
            if (!represented) {
                return true;
            }
        }
        return false;
    }

    private static boolean policyInvalid(JsonNode config, JsonNode minimum, JsonNode maximum, JsonNode lifecycle,
            JsonNode charging, JsonNode decline) {
        return !Js.object(Js.get(config, "preferences")) || !Js.object(Js.get(config, "essentials"))
                || !Js.object(Js.get(config, "tuning"))
                || !(Js.get(config, "retailBudgetEnabled") != null && Js.get(config, "retailBudgetEnabled").isBoolean()
                        && !Js.get(config, "retailBudgetEnabled").booleanValue())
                || !isBool(Js.get(config, "driverEligibilityRequired"))
                || !Js.array(Js.get(config, "confirmedAssurances")) || !Js.array(Js.get(config, "plugInFuels"))
                || !Js.array(Js.get(config, "chargingAccess")) || !isNumber(minimum, 0) || !isNumber(maximum, 100)
                || !Js.object(Js.get(lifecycle, "charging")) || !isBool(charging)
                || !is(decline, "untilRelevantConfirmedBriefChange");
    }

    private static boolean factsValid(JsonNode facts, JsonNode config, String asOf) {
        if (!Js.object(facts)) {
            return false;
        }
        for (Iterator<Map.Entry<String, JsonNode>> it = facts.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> entry = it.next();
            JsonNode f = entry.getValue();
            if (!Js.object(f)) {
                return false;
            }
            JsonNode status = f.get("status");
            boolean unknown = is(status, "unknown");
            if (!(unknown || is(status, "known")) || unknown != (f.get("value") != null && f.get("value").isNull())) {
                return false;
            }
            JsonNode provenance = f.get("provenance");
            if (!Js.text(Js.get(provenance, "sourceRef")) || !Js.text(p(provenance, "version"))
                    || !instant(p(provenance, "observedAt"))
                    || JsTime.parse(provenance.get("observedAt").textValue()) > JsTime.parse(asOf)
                    || unknown != is(provenance.get("assurance"), "unknown")) {
                return false;
            }
            JsonNode unit = f.get("unit");
            if (!(unit != null && unit.isNull() || Js.text(unit))) {
                return false;
            }
            JsonNode value = f.get("value");
            if (value != null && value.isNumber() && (!Double.isFinite(value.doubleValue()) || !Js.text(unit))) {
                return false;
            }
            JsonNode essentials = config.get("essentials");
            if (essentials.has(entry.getKey()) && !eq(unit, p(essentials.get(entry.getKey()), "unit"))) {
                return false;
            }
        }
        return true;
    }

    // ---- declined exact stock (F99 business-value comparison) ----

    private static ArrayNode excludedStock(JsonNode history, JsonNode brief) {
        JsonNode decisions = Js.get(history, "decisions");
        JsonNode offers = Js.get(history, "offers");
        JsonNode briefs = Js.get(history, "briefs");
        if (!Js.array(decisions) || !Js.array(offers) || !Js.array(briefs)) {
            return null;
        }
        JsonNode employeeId = p(brief, "employeeId");
        List<JsonNode> declines = new ArrayList<>();
        for (JsonNode d : decisions) {
            if (eq(p(d, "employeeId"), employeeId) && is(p(d, "decision"), "decline")) {
                declines.add(d);
            }
        }
        Set<String> excluded = new TreeSet<>();
        for (JsonNode decision : declines) {
            JsonNode offer = null;
            for (JsonNode o : offers) {
                if (eq(p(o, "offerId"), p(decision, "offerId")) && eq(p(o, "employeeId"), employeeId)) {
                    offer = o;
                    break;
                }
            }
            if (offer == null || !Js.text(p(offer, "orderUuid"))) {
                return null;
            }
            JsonNode wanted = Js.get(Js.get(decision, "versions"), "brief");
            JsonNode previous = null;
            for (JsonNode b : briefs) {
                if (eq(p(b, "employeeId"), employeeId) && eq(p(b, "briefVersion"), wanted)) {
                    previous = b;
                    break;
                }
            }
            if (previous == null || !is(p(previous, "status"), "confirmed")
                    || CanonicalJson.digest(intent(previous)).equals(CanonicalJson.digest(confirmedIntent(brief, previous)))) {
                excluded.add(offer.get("orderUuid").textValue());
            }
        }
        ArrayNode out = Outcomes.array();
        excluded.forEach(out::add);
        return out;
    }

    /** Missing fields stay MissingNode so the digest throws where Node's inputDigest does on undefined. */
    private static ObjectNode intent(JsonNode brief) {
        ObjectNode out = Outcomes.object();
        ObjectNode preferences = out.putObject("preferences");
        for (Map.Entry<String, JsonNode> e : entriesOrEmpty(p(brief, "preferences"))) {
            JsonNode pref = e.getValue();
            ObjectNode one = preferences.putObject(e.getKey());
            one.set("value", orMissing(BriefRules.intentValue(p(pref, "value"))));
            one.set("importance", orMissing(p(pref, "importance")));
            one.set("valueState", orMissing(p(pref, "valueState")));
            one.set("importanceState", orMissing(p(pref, "importanceState")));
        }
        ObjectNode essentials = out.putObject("essentials");
        for (Map.Entry<String, JsonNode> e : entriesOrEmpty(p(brief, "essentials"))) {
            JsonNode essential = e.getValue();
            JsonNode value = p(essential, "value");
            JsonNode value2 = is(p(essential, "operator"), "includes") && Js.array(value) ? sortedUnique(value) : value;
            ObjectNode one = essentials.putObject(e.getKey());
            one.set("value", orMissing(value2));
            one.set("operator", orMissing(p(essential, "operator")));
            one.set("unit", orMissing(p(essential, "unit")));
            one.set("state", orMissing(p(essential, "state")));
        }
        return out;
    }

    private static ObjectNode confirmedIntent(JsonNode brief, JsonNode previous) {
        ObjectNode value = intent(brief);
        ObjectNode before = intent(previous);
        for (Map.Entry<String, JsonNode> e : entriesOrEmpty(p(brief, "preferences"))) {
            if (is(p(e.getValue(), "valueState"), "confirmed") && is(p(e.getValue(), "importanceState"), "confirmed")) {
                continue;
            }
            if (before.get("preferences").has(e.getKey())) {
                ((ObjectNode) value.get("preferences")).set(e.getKey(), before.get("preferences").get(e.getKey()));
            } else {
                ((ObjectNode) value.get("preferences")).remove(e.getKey());
            }
        }
        for (Map.Entry<String, JsonNode> e : entriesOrEmpty(p(brief, "essentials"))) {
            if (is(p(e.getValue(), "state"), "confirmed")) {
                continue;
            }
            if (before.get("essentials").has(e.getKey())) {
                ((ObjectNode) value.get("essentials")).set(e.getKey(), before.get("essentials").get(e.getKey()));
            } else {
                ((ObjectNode) value.get("essentials")).remove(e.getKey());
            }
        }
        return value;
    }

    /** [...new Set(list)].sort(compare) for the string or number lists a brief can hold. */
    private static JsonNode sortedUnique(JsonNode list) {
        List<JsonNode> unique = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        boolean strings = true;
        boolean numbers = true;
        for (JsonNode n : list) {
            strings &= n.isTextual();
            numbers &= n.isNumber();
            String key = n.isTextual() ? "s:" + n.textValue() : n.isNumber() ? "n:" + JsNum.str(n.doubleValue())
                    : n.isBoolean() ? "b:" + n.booleanValue() : n.isNull() ? "null" : "o:" + System.identityHashCode(n);
            if (seen.add(key)) {
                unique.add(n);
            }
        }
        if (unique.size() > 1 && !strings && !numbers) {
            throw new UnsupportedOperationException("mixed list");
        }
        if (strings) {
            unique.sort((a, b) -> a.textValue().compareTo(b.textValue()));
        } else if (numbers) {
            unique.sort((a, b) -> Double.compare(a.doubleValue(), b.doubleValue()));
        }
        ArrayNode out = Outcomes.array();
        unique.forEach(out::add);
        return out;
    }

    private static List<Map.Entry<String, JsonNode>> entriesOrEmpty(JsonNode node) {
        List<Map.Entry<String, JsonNode>> out = new ArrayList<>();
        if (node == null || node.isNull()) {
            return out;
        }
        if (!node.isObject()) {
            throw new UnsupportedOperationException("not an object");
        }
        node.fields().forEachRemaining(out::add);
        return out;
    }

    private static boolean mentionsSavedBrief(JsonNode node) {
        if (node.isObject() && is(Js.get(node.get("provenance"), "sourceRef"), "saved-brief")
                && node.get("provenance").get("observedAt") == null) {
            return true;
        }
        for (JsonNode child : node) {
            if (mentionsSavedBrief(child)) {
                return true;
            }
        }
        return false;
    }

    // ---- createEmployeeTerms (server/vehicles/index.js), revalidating what the provider returned ----

    private static ObjectNode employeeTerms(JsonNode input) {
        keys(input, List.of("kind", "termsVersion", "points", "allowanceInputs", "contribution", "validFrom",
                "validUntil", "provenance"));
        JsonNode kind = input.get("kind");
        if (kind != null && !is(kind, "employee-scheme")) {
            throw new IllegalArgumentException("kind");
        }
        text(input.get("termsVersion"));
        JsonNode points = input.get("points");
        keys(points, List.of("value", "unit"));
        amount(points.get("value"));
        if (!is(points.get("unit"), "points")) {
            throw new IllegalArgumentException("points.unit");
        }
        JsonNode inputs = input.get("allowanceInputs");
        if (!Js.object(inputs)) {
            throw new IllegalArgumentException("allowanceInputs");
        }
        for (JsonNode one : inputs) {
            keys(one, List.of("value", "unit"));
            amount(one.get("value"));
            if (!is(one.get("unit"), "points")) {
                throw new IllegalArgumentException("allowanceInputs.unit");
            }
        }
        JsonNode contribution = input.get("contribution");
        if (contribution == null) {
            throw new IllegalArgumentException("contribution");
        }
        if (!contribution.isNull()) {
            keys(contribution, List.of("amount", "currency", "period"));
            amount(contribution.get("amount"));
            JsonNode currency = contribution.get("currency");
            if (currency == null || !currency.isTextual() || !CURRENCY.matcher(currency.textValue()).matches()
                    || !in(List.of("month", "year", "one-off"), contribution.get("period"))) {
                throw new IllegalArgumentException("contribution");
            }
        }
        date(input.get("validFrom"));
        date(input.get("validUntil"));
        if (JsTime.parse(input.get("validUntil").textValue()) <= JsTime.parse(input.get("validFrom").textValue())) {
            throw new IllegalArgumentException("terms validity");
        }
        JsonNode provenance = input.get("provenance");
        keys(provenance, List.of("sourceRef", "observedAt", "version", "assurance"));
        text(provenance.get("sourceRef"));
        text(provenance.get("version"));
        date(provenance.get("observedAt"));
        if (!in(ASSURANCES, provenance.get("assurance"))) {
            throw new IllegalArgumentException("provenance.assurance");
        }
        ObjectNode result = input.deepCopy();
        result.put("kind", "employee-scheme");
        return result;
    }

    private static void keys(JsonNode value, List<String> allowed) {
        if (!Js.object(value)) {
            throw new IllegalArgumentException("object");
        }
        value.fieldNames().forEachRemaining(name -> {
            if (!allowed.contains(name)) {
                throw new IllegalArgumentException(name);
            }
        });
    }

    private static void amount(JsonNode n) {
        if (n == null || !n.isNumber() || !Double.isFinite(n.doubleValue()) || n.doubleValue() < 0) {
            throw new IllegalArgumentException("amount");
        }
    }

    private static void text(JsonNode n) {
        if (n == null || !n.isTextual() || jsTrim(n.textValue()).isEmpty()) {
            throw new IllegalArgumentException("text");
        }
    }

    private static void date(JsonNode n) {
        text(n);
        if (!STRICT_DATE.matcher(n.textValue()).matches() || JsTime.parse(n.textValue()) == null) {
            throw new IllegalArgumentException("date");
        }
    }

    /** String.prototype.trim: the ECMAScript WhiteSpace and LineTerminator sets. */
    private static String jsTrim(String s) {
        int start = 0;
        int end = s.length();
        while (start < end && jsSpace(s.charAt(start))) {
            start++;
        }
        while (end > start && jsSpace(s.charAt(end - 1))) {
            end--;
        }
        return s.substring(start, end);
    }

    private static boolean jsSpace(char c) {
        return c == 32 || c >= 9 && c <= 13 || c == 160 || c == 5760 || c >= 8192 && c <= 8202 || c == 8232
                || c == 8233 || c == 8239 || c == 8287 || c == 12288 || c == 65279;
    }

    // ---- small JS-semantics helpers ----

    /** base.key for an object, undefined otherwise; a null or undefined base throws, as in JS. */
    private static JsonNode p(JsonNode base, String key) {
        if (base == null || base.isNull()) {
            throw new IllegalStateException("Cannot read '" + key + "'");
        }
        return base.isObject() ? base.get(key) : null;
    }

    /** a === b over JSON values (undefined is a null reference; containers never compare equal). */
    private static boolean eq(JsonNode a, JsonNode b) {
        if (a == null || b == null) {
            return a == b;
        }
        if (a.isNull() || b.isNull()) {
            return a.isNull() && b.isNull();
        }
        if (a.isTextual() && b.isTextual()) {
            return a.textValue().equals(b.textValue());
        }
        if (a.isNumber() && b.isNumber()) {
            return a.doubleValue() == b.doubleValue();
        }
        return a.isBoolean() && b.isBoolean() && a.booleanValue() == b.booleanValue();
    }

    private static boolean is(JsonNode n, String s) {
        return n != null && n.isTextual() && n.textValue().equals(s);
    }

    private static boolean sameString(JsonNode n, String s) {
        return n == null ? s == null : n.isTextual() && n.textValue().equals(s);
    }

    private static String str(JsonNode n) {
        return n != null && n.isTextual() ? n.textValue() : null;
    }

    private static boolean isBool(JsonNode n) {
        return n != null && n.isBoolean();
    }

    private static boolean isNumber(JsonNode n, double expected) {
        return n != null && n.isNumber() && n.doubleValue() == expected;
    }

    /** list.includes(value) for a string list; a non-string value is never in it. */
    private static boolean in(List<String> list, JsonNode value) {
        return value != null && value.isTextual() && list.contains(value.textValue());
    }

    private static boolean gte(JsonNode a, JsonNode b) {
        return a != null && b != null && a.isNumber() && b.isNumber() && a.doubleValue() >= b.doubleValue();
    }

    private static boolean instant(JsonNode n) {
        return n != null && n.isTextual() && JsTime.parse(n.textValue()) != null;
    }

    private static boolean includes(JsonNode list, JsonNode value) {
        if (list == null || !list.isArray()) {
            throw new IllegalStateException("includes");
        }
        for (JsonNode e : list) {
            if (eq(e, value)) {
                return true;
            }
        }
        return false;
    }

    private static JsonNode orMissing(JsonNode n) {
        return n == null ? MissingNode.getInstance() : n;
    }

    private static JsonNode copy(JsonNode n) {
        return n == null ? null : n.deepCopy();
    }

    private static void putIfPresent(ObjectNode target, String key, JsonNode value) {
        if (value != null) {
            target.set(key, value.deepCopy());
        }
    }

    private static ObjectNode code(String code) {
        ObjectNode n = Outcomes.object();
        n.put("code", code);
        return n;
    }
}
