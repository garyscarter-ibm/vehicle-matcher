package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;

/** Eligibility gates (essentials and charging), ported from server/scenarios/employee/index.js. */
public final class Gates {

    private Gates() {}

    /** Blockers, unknowns and reasons, each an array of the Node evidence objects. */
    public record Result(ArrayNode blockers, ArrayNode unknowns, ArrayNode reasons) {

        static Result empty() {
            return new Result(Js.arr(), Js.arr(), Js.arr());
        }

        public ObjectNode toJson() {
            ObjectNode n = Js.obj();
            n.set("blockers", blockers);
            n.set("unknowns", unknowns);
            n.set("reasons", reasons);
            return n;
        }
    }

    /** A known, non-null fact with a complete provenance from a confirmed assurance. */
    public static boolean confirmedFact(JsonNode fact, RecommendationConfig config) {
        if (Js.nullish(fact) || !Js.eqStr(fact.get("status"), "known")) return false;
        JsonNode value = fact.get("value");
        if (value != null && value.isNull()) return false;
        JsonNode provenance = fact.get("provenance");
        JsonNode assurance = Js.opt(provenance, "assurance");
        return Js.text(Js.opt(provenance, "sourceRef")) && Js.text(Js.opt(provenance, "version"))
                && Js.validInstant(Js.opt(provenance, "observedAt"))
                && Js.includes(config.read("confirmedAssurances"), assurance);
    }

    // Editor placeholders describe an unanswered optional control, not an employee requirement.
    public static boolean unselectedPracticalAnswer(JsonNode answer) {
        return !Js.nullish(answer) && Js.eqStr(answer.get("source"), "policy:brief.editor.v1")
                && Js.eqStr(answer.get("state"), "needs-confirmation")
                && answer.get("value") != null && answer.get("value").isNull();
    }

    public static boolean unselectedPreference(JsonNode preference) {
        return !Js.nullish(preference) && Js.eqStr(preference.get("source"), "policy:brief.editor.v1")
                && Js.eqStr(preference.get("valueState"), "draft") && Js.eqStr(preference.get("importanceState"), "draft");
    }

    public static Result chargingGates(JsonNode snapshot, JsonNode employeeFacts, RecommendationConfig config, boolean required) {
        if (!required) return Result.empty();
        JsonNode fuel = Js.at(snapshot, "facts", "fuel");
        JsonNode fuels = Js.at(config.read("preferences"), "fuel", "values");
        if (!confirmedFact(fuel, config) || !Js.includes(fuels, fuel.get("value"))) {
            return new Result(Js.arr(), single("fuel-unconfirmed", fuel), Js.arr());
        }
        if (!Js.includes(config.read("plugInFuels"), fuel.get("value"))) return Result.empty();
        JsonNode charging = Js.get(employeeFacts, "charging");
        if (!confirmedFact(charging, config)) return new Result(Js.arr(), single("charging-unconfirmed", charging), Js.arr());
        ArrayNode one = Js.arr();
        if (Js.includes(config.read("chargingAccess"), charging.get("value"))) {
            one.add(new Js.B().s("code", "charging-ready").s("fact", charging).build());
            return new Result(Js.arr(), Js.arr(), one);
        }
        one.add(new Js.B().s("code", "charging-unavailable").s("fact", charging).build());
        return new Result(one, Js.arr(), Js.arr());
    }

    private static ArrayNode single(String code, JsonNode fact) {
        ArrayNode list = Js.arr();
        list.add(new Js.B().s("code", code).s("fact", Js.orNull(fact)).build());
        return list;
    }

    /** `optionalDefaults` skips unselected editor placeholders. */
    public static Result evaluateEssentials(JsonNode snapshot, JsonNode brief, RecommendationConfig config, boolean optionalDefaults) {
        Result out = Result.empty();
        JsonNode facts = Js.get(snapshot, "facts");
        for (Map.Entry<String, JsonNode> entry : Js.entries(Js.get(brief, "essentials"))) {
            String field = entry.getKey();
            JsonNode requirement = entry.getValue();
            if (optionalDefaults && unselectedPracticalAnswer(requirement)) continue;
            JsonNode fact = Js.get(facts, field);
            boolean confirmed = Js.eqStr(Js.get(requirement, "state"), "confirmed");
            JsonNode operator = Js.get(requirement, "operator");
            if (confirmed && (Js.eqStr(operator, "includes") && length(Js.get(requirement, "value")) == 0
                    || Js.eqStr(operator, "gte") && Js.strictEq(Js.get(requirement, "value"), Js.F.numberNode(0)))) {
                out.reasons().add(evidence("essential-met", field, requirement, Js.orNull(fact)));
                continue;
            }
            if (!confirmed || !confirmedFact(fact, config)) {
                out.unknowns().add(evidence("essential-unconfirmed", field, requirement, Js.orNull(fact)));
                continue;
            }
            JsonNode required = Js.get(requirement, "value");
            JsonNode actual = fact.get("value");
            boolean met;
            if (Js.eqStr(operator, "gte")) {
                met = actual != null && actual.isNumber() && actual.doubleValue() >= Js.toNumber(required);
            } else if (Js.eqStr(operator, "equals")) {
                met = Js.strictEq(actual, required);
            } else {
                if (required == null || !required.isArray()) throw new RecommendationFault("filter is not a function");
                ArrayNode missing = Js.arr();
                for (JsonNode key : required) {
                    JsonNode held = Js.prop(actual, Js.key(key));
                    if (!Js.hasOwn(actual, Js.key(key)) || !Js.isBool(held)) missing.add(key);
                }
                if (missing.size() > 0) {
                    out.unknowns().add(new Js.B().s("code", "equipment-unconfirmed").s("field", field).s("keys", missing)
                            .s("fact", fact).build());
                    continue;
                }
                met = true;
                for (JsonNode key : required) met &= Js.eqBool(Js.prop(actual, Js.key(key)), true);
            }
            (met ? out.reasons() : out.blockers()).add(evidence(met ? "essential-met" : "essential-unmet", field, requirement, fact));
        }
        return out;
    }

    /** The `.length` of an array or string; other values have none (undefined), and a nullish base throws. */
    private static int length(JsonNode value) {
        if (Js.nullish(value)) throw new RecommendationFault("Cannot read 'length' of nullish");
        if (value.isArray()) return value.size();
        return value.isTextual() ? value.textValue().length() : -1;
    }

    private static ObjectNode evidence(String code, String field, JsonNode requirement, JsonNode fact) {
        return new Js.B().s("code", code).s("field", field).s("requirement", requirement).s("fact", fact).build();
    }
}
