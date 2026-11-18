package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.persistence.Canonical;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.List;

/** Calculates allocation candidates from the caller's frozen transaction inputs; it grants no session authority. */
public final class RecommendationCandidates implements EligibleCandidates {

    private static final List<String> QUOTE = List.of("orderUuid", "configurationId", "snapshot", "terms",
            "employeeFacts", "reasons", "tradeOffs", "versions");
    private final PolicyService policy;

    public RecommendationCandidates(PolicyService policy) {
        this.policy = policy;
    }

    @Override
    public Result evaluate(Request request) {
        try {
            if (request == null || request.subject() == null || request.asOf() == null || request.clockVersion() <= 0
                    || request.cars() == null) return unavailable();
            Subject subject = request.subject();
            if (subject.employeeVersion() <= 0 || subject.briefVersion() <= 0 || !text(subject.employeeId())
                    || !text(subject.slotId()) || !Js.object(subject.employeeAttributes())
                    || !Js.object(subject.accountRecord()) || !Js.object(subject.accountRecord().get("employeeFacts"))
                    || !Js.object(subject.briefContent()) || !Js.object(subject.briefContent().get("preferences"))
                    || !Js.object(subject.briefContent().get("essentials"))) return unavailable();
            JsonNode attributes = subject.employeeAttributes();
            RecommendationContext context = new RecommendationContext(request.runId(), request.environmentId(),
                    subject.employeeId(), string(attributes.get("companyId")), string(attributes.get("schemeId")),
                    string(attributes.get("gradeId")), request.policyVersion(), List.of("employee"), subject.slotId());
            String now = PolicyClock.iso(request.asOf());
            ObjectNode facts = employeeFacts(subject);
            ObjectNode brief = brief(subject);
            ArrayNode stock = stock(request.cars());
            ObjectNode source = new Js.B().s("runId", request.runId()).s("environmentId", request.environmentId())
                    .s("employeeId", subject.employeeId())
                    .s("factsVersion", "employee:" + subject.employeeVersion() + ":" + Canonical.digest(subject.accountRecord()))
                    .s("stockVersion", "stock:" + Canonical.digest(stock)).s("employeeFacts", facts).s("stock", stock).build();
            if (brief.has("currentCarRating") || brief.has("sameAgain")) {
                ObjectNode baseline = baseline(subject, context, now);
                if (baseline != null) source.set("currentCar", baseline);
            }
            RecommendationClock clock = ignored -> new Js.B().s("status", "ok").s("value",
                    new Js.B().s("runId", request.runId()).s("now", now)
                            .s("clockVersion", Long.toString(request.clockVersion())).build()).build();
            ObjectNode outcome = Evaluation.run(ignored -> new Js.B().s("status", "ok").s("value", source).build(),
                    policy, clock, context, brief, null);
            if (!Js.eqStr(outcome.get("status"), "ok")) {
                return new Unavailable(Js.text(outcome.get("code")) ? outcome.get("code").textValue()
                        : "recommendation-unavailable");
            }
            JsonNode value = outcome.get("value");
            if (!Js.eqStr(value.path("versions").get("policy"), request.policyVersion())) {
                return new Unavailable("stored-subject-policy-mismatch");
            }
            List<Decision> decisions = new ArrayList<>();
            for (JsonNode decision : value.get("decisions")) {
                JsonNode score = decision.get("score");
                ObjectNode quote = Js.obj();
                for (String key : QUOTE) quote.set(key, decision.get(key).deepCopy());
                decisions.add(new Decision(decision.get("orderUuid").textValue(), decision.get("gateStatus").textValue(),
                        score.isNull() ? null : score.doubleValue(), decision.get("reasons").deepCopy(),
                        decision.get("blockers").deepCopy(), decision.get("unknowns").deepCopy(),
                        decision.get("versions").deepCopy(), quote));
            }
            return new Evaluated(value.get("versions").deepCopy(), List.copyOf(decisions));
        } catch (RuntimeException e) {
            return unavailable();
        }
    }

    private static ObjectNode employeeFacts(Subject subject) {
        ObjectNode facts = subject.accountRecord().get("employeeFacts").deepCopy();
        JsonNode drivers = subject.accountRecord().get("drivers");
        if (!facts.has("driverEligible") && drivers != null && drivers.isArray()) {
            for (JsonNode driver : drivers) {
                if (Js.eqStr(driver.get("kind"), "employee") && Js.eqStr(driver.get("employeeId"), subject.employeeId())) {
                    if (driver.has("eligible")) facts.set("driverEligible", driver.get("eligible").deepCopy());
                    break;
                }
            }
        }
        JsonNode answer = subject.briefContent().path("essentials").get("charging");
        if (!Gates.unselectedPracticalAnswer(answer)) {
            JsonNode source = Js.opt(answer, "source");
            JsonNode observed = Js.opt(answer, "confirmedAt");
            JsonNode value = Js.opt(answer, "value");
            boolean known = Js.eqStr(Js.opt(answer, "state"), "confirmed") && !Js.nullish(value)
                    && Js.text(source) && Js.validInstant(observed);
            facts.set("charging", new Js.B().s("status", known ? "known" : "unknown").s("value", Js.orNull(value))
                    .s("unit", Js.F.nullNode()).s("provenance", new Js.B().s("sourceRef", Js.orNull(source))
                            .s("version", Long.toString(subject.briefVersion())).s("observedAt", Js.orNull(observed))
                            .s("assurance", "synthetic-scenario").build()).build());
        }
        return facts;
    }

    private static ObjectNode brief(Subject subject) {
        JsonNode saved = subject.briefContent();
        ObjectNode brief = Js.obj();
        for (String key : List.of("schemaVersion", "preferences", "requiredBy", "currentCarRating", "sameAgain")) {
            if (saved.has(key)) brief.set(key, saved.get(key).deepCopy());
        }
        brief.put("briefVersion", subject.briefVersion());
        ObjectNode essentials = Js.obj();
        for (var entry : Js.entries(saved.get("essentials"))) {
            if (!entry.getKey().equals("charging")) essentials.set(entry.getKey(), entry.getValue().deepCopy());
        }
        brief.set("essentials", essentials);
        return brief;
    }

    private static ArrayNode stock(List<Car> cars) {
        ArrayNode stock = Js.arr();
        for (Car car : cars) {
            if (car == null || car.version() <= 0 || !Js.object(car.attributes())) {
                throw new RecommendationFault("Invalid frozen stock");
            }
            JsonNode release = car.attributes().get("release");
            JsonNode listed = Js.opt(release, "availability");
            ObjectNode availability = Js.nullish(listed) ? Js.obj() : ((ObjectNode) listed).deepCopy();
            availability.put("state", "available").put("version", Long.toString(car.version()));
            if (Js.nullish(availability.get("availableFrom"))) {
                JsonNode releasedAt = Js.opt(release, "releasedAt");
                if (releasedAt != null) availability.set("availableFrom", releasedAt.deepCopy());
            }
            stock.add(new Js.B().s("orderUuid", car.orderUuid()).s("configurationId", car.configurationId())
                    .s("snapshot", Js.orNull(car.attributes().get("facts"))).s("availability", availability).build());
        }
        return stock;
    }

    private static ObjectNode baseline(Subject subject, RecommendationContext context, String now) {
        JsonNode contracts = subject.accountRecord().get("contracts");
        if (contracts == null || !contracts.isArray()) return null;
        JsonNode selected = null;
        for (JsonNode contract : contracts) {
            if (!Js.eqStr(contract.get("status"), "current") || !Js.eqStr(contract.get("employeeId"), subject.employeeId())
                    || !Js.eqStr(contract.get("schemeId"), context.schemeId())
                    || !Js.eqStr(contract.get("slotId"), subject.slotId())) continue;
            if (selected != null) return null;
            selected = contract;
        }
        return selected == null ? null : CurrentCarBaseline.project(subject.accountRecord().get("source"), contracts,
                selected.get("contractId"), context, now);
    }

    private static boolean text(String value) {
        return value != null && Js.text(Js.F.textNode(value));
    }

    private static String string(JsonNode value) {
        return Js.text(value) ? value.textValue() : null;
    }

    private static Unavailable unavailable() {
        return new Unavailable("recommendation-unavailable");
    }
}
