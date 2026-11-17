package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import javax.sql.DataSource;

/**
 * PlanningDemand from saved confirmed briefs: a port of Node createExpressedOrderForecastProvider (FUCQ-477).
 * Rows, clock and catalogue are read twice; any change between the two reads is a conflict.
 */
public final class PostgresPlanningDemand implements PlanningDemand {

    static final String BASIS = "expressed-saved-demand";
    static final String SOURCE = "F99-authoritative-saved-briefs-internal-extension";
    static final List<String> LIMITATIONS = List.of(
            "Saved confirmed briefs only; employees without a saved brief are not inferred.",
            "Deterministic permitted joint choices are not calibrated acceptance probabilities.");

    /** The seven demand tables for one run, or null when the run is not the active one. */
    interface Rows {
        ObjectNode load(RunContext context) throws SQLException;
    }

    /** One employee's future-choice evaluation (Node futureChoices.evaluateChoices). */
    interface Evaluator {
        ObjectNode evaluate(Principal principal, JsonNode input, PolicyService policy);
    }

    static final Evaluator FUTURE_CHOICES = (principal, input, policy) ->
            new FutureChoiceEvaluator(policy, new PolicyFutureTerms(policy)).evaluateChoices(principal, input);

    private final Rows rows;
    private final PlanningClock clock;
    private final Evaluator evaluator;

    PostgresPlanningDemand(Rows rows, PlanningClock clock, Evaluator evaluator) {
        this.rows = rows;
        this.clock = clock;
        this.evaluator = evaluator;
    }

    static PostgresPlanningDemand over(DataSource source, PlanningClock clock) {
        return new PostgresPlanningDemand(source == null ? null : context -> PostgresDemandSnapshot.load(source, context),
                clock, FUTURE_CHOICES);
    }

    /** Binds the adapter only when persistence is active; otherwise the unconfigured default stays the bean. */
    @ApplicationScoped
    static class Wiring {

        @Inject
        Persistence persistence;

        @Inject
        Instance<AgroalDataSource> dataSource;

        @Inject
        PlanningClock clock;

        @Produces
        @ApplicationScoped
        PlanningDemand planningDemand() {
            return persistence.active() ? over(dataSource.get(), clock) : new PlanningDefaults.UnconfiguredDemand();
        }
    }

    @Override
    public ObjectNode readForecast(PlanningRead read, PolicyService policy) {
        if (rows == null || clock == null || evaluator == null || policy == null) {
            return Outcomes.unavailable("planning-future-choice-evaluator-not-configured");
        }
        try {
            if (read == null || read.context() == null || !text(read.runId()) || !text(read.policyVersion())
                    || JsTime.parse(read.asOf()) == null || JsTime.parse(read.horizonEnd()) == null) {
                return Outcomes.unavailable("planning-forecast-read-invalid");
            }
            RunContext context = read.context();
            PlanningClock.Observation time = clock.observe(context);
            if (!PolicyClock.iso(time.now()).equals(read.asOf())) {
                return Outcomes.unavailable("planning-forecast-clock-mismatch");
            }
            ObjectNode before = rows.load(context);
            if (before == null) {
                return Outcomes.unavailable("planning-forecast-read-invalid");
            }
            ObjectNode choices = catalog(read, policy);
            if (!Outcomes.isOk(choices)) {
                return choices;
            }
            JsonNode catalog = choices.get("value");
            if (!same(catalog, "runId", read.runId()) || !same(catalog, "policyVersion", read.policyVersion())
                    || !same(catalog, "asOf", read.asOf()) || !Js.text(catalog.get("version")) || !Js.array(catalog.get("derivatives"))) {
                return Outcomes.unavailable("planning-forecast-catalog-mismatch");
            }
            Set<JsonNode> derivativeIds = new HashSet<>();
            for (JsonNode d : catalog.get("derivatives")) {
                derivativeIds.add(Js.get(d, "derivativeId"));
            }
            ObjectNode readJson = readJson(read);
            Principal principal = new Principal(context.actorId(), List.of("greg"), context.environmentId(), read.runId(), null,
                    read.policyVersion(), List.of());
            ArrayNode entitlements = Outcomes.array();
            ArrayNode evaluations = Outcomes.array();
            ArrayNode excluded = Outcomes.array();
            for (DemandCohort.Step step : DemandCohort.steps(before, read.horizonEnd())) {
                if (step instanceof DemandCohort.Failure f) {
                    return Outcomes.unavailable(f.code());
                }
                if (step instanceof DemandCohort.Excluded x) {
                    excluded.addObject().put("employeeId", x.employeeId()).put("reason", x.reason());
                    continue;
                }
                DemandCohort.Member m = (DemandCohort.Member) step;
                ObjectNode evaluated = evaluator.evaluate(principal, input(readJson, m, catalog, before), policy);
                if (!Outcomes.isOk(evaluated)) {
                    return evaluated != null && evaluated.get("status") != null && !evaluated.get("status").isNull()
                            ? evaluated : Outcomes.unavailable("planning-future-choice-evaluation-unavailable");
                }
                JsonNode value = evaluated.get("value");
                if (!validEvaluation(value, read, m, catalog, derivativeIds)) {
                    return Outcomes.unavailable("planning-future-choice-evaluation-invalid");
                }
                evaluations.add(value);
                entitlements.add(entitlement(m, value));
            }
            ObjectNode after = rows.load(context);
            PlanningClock.Observation end = clock.observe(context);
            ObjectNode choicesAfter = catalog(read, policy);
            if (!Outcomes.isOk(choicesAfter)) {
                return choicesAfter;
            }
            if (after == null || !CanonicalJson.digest(before).equals(CanonicalJson.digest(after)) || !time.equals(end)
                    || !CanonicalJson.digest(catalog).equals(CanonicalJson.digest(choicesAfter.get("value")))) {
                return Outcomes.conflict("planning-forecast-changed");
            }
            return Outcomes.ok(value(read, readJson, before, catalog, entitlements, evaluations, excluded));
        } catch (SQLException | RuntimeException e) {
            return Outcomes.unavailable("planning-expressed-forecast-unavailable");
        }
    }

    private static ObjectNode catalog(PlanningRead read, PolicyService policy) {
        return new PlanningCatalog(policy).readCatalog(read.runId(), new PolicyRead(read.runId(), read.asOf(), read.policyVersion()));
    }

    private static ObjectNode readJson(PlanningRead read) {
        return Outcomes.object().put("runId", read.runId()).put("asOf", read.asOf()).put("policyVersion", read.policyVersion())
                .put("horizonEnd", read.horizonEnd());
    }

    private static ObjectNode input(ObjectNode read, DemandCohort.Member m, JsonNode catalog, JsonNode rows) {
        ObjectNode in = Outcomes.object();
        in.set("read", read.deepCopy());
        in.set("employee", m.employee().deepCopy());
        in.set("brief", m.brief().deepCopy());
        in.set("catalog", catalog.deepCopy());
        ObjectNode history = in.putObject("history");
        history.set("decisions", rows.get("decisions").deepCopy());
        history.set("offers", rows.get("offers").deepCopy());
        history.set("briefs", rows.get("briefs").deepCopy());
        return in;
    }

    /** Node's evaluation guard, in its order: identity, versions, then each list's shape. */
    private static boolean validEvaluation(JsonNode v, PlanningRead read, DemandCohort.Member m, JsonNode catalog,
            Set<JsonNode> derivativeIds) {
        if (!Js.object(v) || !same(v, "runId", read.runId()) || !same(v, "policyVersion", read.policyVersion())
                || !strict(v.get("employeeId"), m.employee().get("employeeId"))
                || !strict(v.get("briefVersion"), m.brief().get("briefVersion"))
                || !strict(v.get("catalogVersion"), catalog.get("version")) || !Js.text(v.get("version"))) {
            return false;
        }
        JsonNode acceptable = v.get("acceptableDerivativeIds");
        if (!Js.array(acceptable) || !Js.items(acceptable).stream().allMatch(derivativeIds::contains)
                || !Js.unique(Js.items(acceptable)) || !Js.array(v.get("gates"))) {
            return false;
        }
        JsonNode excludedStock = v.get("excludedStockIds");
        if (excludedStock != null && (!Js.array(excludedStock) || !Js.everyText(excludedStock) || !Js.unique(Js.items(excludedStock)))) {
            return false;
        }
        JsonNode requiredBy = v.get("requiredBy");
        if (requiredBy != null) {
            Long by = requiredBy.isTextual() ? JsTime.parse(requiredBy.textValue()) : null;
            if (by == null || by > JsTime.parse(m.renewalAt())) {
                return false;
            }
        }
        return Js.everyText(v.get("gates")) && Js.array(v.get("limitations")) && Js.everyText(v.get("limitations"));
    }

    private static ObjectNode entitlement(DemandCohort.Member m, JsonNode value) {
        JsonNode employee = m.employee();
        JsonNode slotId = m.slot().get("entitlementSlotId");
        ObjectNode e = Outcomes.object();
        e.set("entitlementId", slotId.deepCopy());
        e.set("employeeId", employee.get("employeeId").deepCopy());
        e.set("renewalId", employee.get("renewalId").deepCopy());
        e.set("entitlementSlotId", slotId.deepCopy());
        copyPresent(e, employee, "companyId");
        copyPresent(e, employee, "schemeId");
        e.put("renewalAt", m.renewalAt());
        e.set("acceptableDerivativeIds", sorted(value.get("acceptableDerivativeIds")));
        e.set("gates", sorted(value.get("gates")));
        if (value.get("excludedStockIds") != null) {
            e.set("excludedStockIds", sorted(value.get("excludedStockIds")));
        }
        if (value.get("requiredBy") != null) {
            e.set("requiredBy", value.get("requiredBy").deepCopy());
        }
        return e;
    }

    private static ObjectNode value(PlanningRead read, ObjectNode readJson, ObjectNode rows, JsonNode catalog,
            ArrayNode entitlements, ArrayNode evaluations, ArrayNode excluded) {
        ObjectNode cohort = Outcomes.object();
        cohort.set("employees", rows.get("employees"));
        cohort.set("slots", rows.get("entitlement_slots"));
        cohort.set("selected", excluded);
        ObjectNode version = Outcomes.object();
        version.set("rows", rows);
        version.set("evaluations", evaluations);
        version.set("catalog", catalog.get("version"));
        version.set("read", readJson);
        ObjectNode value = Outcomes.object();
        value.put("runId", read.runId()).put("asOf", read.asOf()).put("policyVersion", read.policyVersion());
        value.put("version", CanonicalJson.digest(version));
        value.put("cohortVersion", CanonicalJson.digest(cohort));
        ObjectNode forecast = value.putObject("forecast");
        forecast.put("basis", BASIS).put("horizonEnd", read.horizonEnd());
        forecast.set("entitlements", entitlements);
        Set<String> limitations = new LinkedHashSet<>(LIMITATIONS);
        for (JsonNode e : evaluations) {
            for (JsonNode l : e.get("limitations")) {
                limitations.add(l.textValue());
            }
        }
        ArrayNode limits = forecast.putArray("limitations");
        limitations.forEach(limits::add);
        ObjectNode provenance = value.putObject("provenance");
        provenance.put("source", SOURCE);
        provenance.set("catalogVersion", catalog.get("version").deepCopy());
        ArrayNode versions = provenance.putArray("evaluationVersions");
        evaluations.forEach(e -> versions.add(e.get("version").deepCopy()));
        provenance.set("excluded", excluded.deepCopy());
        return value;
    }

    private static ArrayNode sorted(JsonNode texts) {
        List<String> values = new ArrayList<>();
        texts.forEach(t -> values.add(t.textValue()));
        values.sort(String::compareTo);
        ArrayNode out = Outcomes.array();
        values.forEach(out::add);
        return out;
    }

    private static void copyPresent(ObjectNode out, JsonNode from, String key) {
        if (from.has(key)) {
            out.set(key, from.get(key).deepCopy());
        }
    }

    private static boolean text(String s) {
        return s != null && !s.isEmpty() && s.length() <= 512;
    }

    private static boolean same(JsonNode n, String field, String expected) {
        JsonNode v = Js.get(n, field);
        return v != null && v.isTextual() && v.textValue().equals(expected);
    }

    /** JS ===: numbers by value, everything else JsonNode.equals; absent never equals present. */
    private static boolean strict(JsonNode a, JsonNode b) {
        if (a == null || b == null) {
            return a == b;
        }
        return a.isNumber() && b.isNumber() ? a.doubleValue() == b.doubleValue() : a.equals(b);
    }
}
