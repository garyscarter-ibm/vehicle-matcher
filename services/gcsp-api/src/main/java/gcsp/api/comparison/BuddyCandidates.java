package gcsp.api.comparison;

import static gcsp.api.comparison.ReplayRecords.JSON;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import gcsp.api.recommendation.Gates;
import gcsp.api.recommendation.RecommendationClock;
import gcsp.api.recommendation.RecommendationSource;
import gcsp.api.recommendation.StoredSubjectEvaluator;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Recommendation port for the replay: stored facts and brief through the Java evaluator, one evaluation per car group. */
final class BuddyCandidates implements EligibleCandidates {

    private final PolicyService policy;

    BuddyCandidates(PolicyService policy) {
        this.policy = policy;
    }

    private record Group(EligibleCandidates.Car rep, List<EligibleCandidates.Car> members) {}

    @Override
    public Result evaluate(Request request) {
        Subject s = request.subject();
        JsonNode brief = s.briefContent();
        JsonNode record = s.accountRecord();
        if (!record.isObject() || !brief.isObject()) return new Unavailable("recommendation-unavailable");
        if (brief.has("currentCarRating") || brief.has("sameAgain")) return new Unavailable("feedback-baseline-unavailable");
        ObjectNode facts = record.path("employeeFacts").isObject() ? ((ObjectNode) record.get("employeeFacts")).deepCopy() : JSON.objectNode();
        if (!facts.has("driverEligible")) {
            for (JsonNode d : record.path("drivers")) {
                if ("employee".equals(d.path("kind").asText()) && s.employeeId().equals(d.path("employeeId").asText(null))
                        && d.path("eligible").isObject() && d.path("eligible").size() > 0) {
                    facts.set("driverEligible", d.get("eligible").deepCopy());
                    break;
                }
            }
        }
        JsonNode charging = brief.path("essentials").get("charging");
        boolean unselected = Gates.unselectedPracticalAnswer(charging);
        String asOf = PolicyClock.iso(request.asOf());
        if (charging != null && !charging.isNull() && !unselected) facts.set("charging", chargingFact(charging, s.briefVersion(), asOf));
        ObjectNode gateFacts = facts;
        if (!unselected) {
            gateFacts = facts.deepCopy();
            gateFacts.set("charging", chargingFact(charging, s.briefVersion(), asOf));
        }

        Map<String, Group> groups = new LinkedHashMap<>();
        for (EligibleCandidates.Car car : request.cars()) {
            JsonNode a = car.attributes().path("release").path("availability");
            String key = car.configurationId() + "\u0000" + car.attributes().path("factsDigest").asText() + "\u0000"
                    + a.path("state").asText() + "\u0000" + a.path("availableFrom").asText() + "\u0000"
                    + a.path("availableUntil").asText();
            groups.computeIfAbsent(key, k -> new Group(car, new ArrayList<>())).members().add(car);
        }
        ArrayNode stock = JSON.arrayNode();
        for (Group g : groups.values()) stock.add(entry(g.rep()));

        ObjectNode brf = JSON.objectNode();
        brf.set("schemaVersion", brief.get("schemaVersion"));
        brf.put("briefVersion", s.briefVersion());
        brf.set("preferences", brief.get("preferences"));
        ObjectNode essentials = brf.putObject("essentials");
        brief.path("essentials").fields().forEachRemaining(e -> {
            if (!e.getKey().equals("charging")) essentials.set(e.getKey(), e.getValue());
        });

        ObjectNode subject = JSON.objectNode();
        subject.put("runId", request.runId());
        subject.put("environmentId", request.environmentId());
        subject.put("employeeId", s.employeeId());
        for (String key : new String[] {"companyId", "schemeId", "gradeId"}) subject.set(key, s.employeeAttributes().get(key));
        subject.put("policyVersion", request.policyVersion());
        StringBuilder ids = new StringBuilder();
        for (EligibleCandidates.Car car : request.cars()) ids.append(car.orderUuid()).append(':').append(car.version()).append(',');
        String stockVersion = "allocation-pool:" + Integer.toHexString(ids.toString().hashCode()) + ":" + request.cars().size();
        ObjectNode feed = JSON.objectNode();
        feed.put("runId", request.runId());
        feed.put("environmentId", request.environmentId());
        feed.put("employeeId", s.employeeId());
        feed.put("factsVersion", "employee:" + s.employeeVersion());
        feed.put("stockVersion", stockVersion);
        feed.set("employeeFacts", gateFacts);
        feed.set("stock", stock);
        RecommendationSource source = context -> {
            ObjectNode out = JSON.objectNode();
            out.put("status", "ok");
            out.set("value", feed);
            return out;
        };
        RecommendationClock time = context -> {
            ObjectNode out = JSON.objectNode();
            out.put("status", "ok");
            ObjectNode body = out.putObject("value");
            body.put("runId", context.runId());
            body.put("now", asOf);
            body.put("clockVersion", "comparison-clock:" + request.clockVersion());
            return out;
        };
        ObjectNode outcome = new StoredSubjectEvaluator(source, policy, time).evaluate(subject, brf);
        if (!"ok".equals(ReplayRecords.text(outcome.get("status")))) return new Unavailable("recommendation-unavailable");
        JsonNode value = outcome.get("value");
        Map<String, JsonNode> byRep = new LinkedHashMap<>();
        for (JsonNode d : value.get("decisions")) byRep.put(d.get("orderUuid").textValue(), d);
        List<Decision> decisions = new ArrayList<>();
        for (Group g : groups.values()) {
            JsonNode d = byRep.get(g.rep().orderUuid());
            if (d == null) return new Unavailable("recommendation-unavailable");
            for (EligibleCandidates.Car car : g.members()) decisions.add(decision(d, car, g.rep(), facts));
        }
        return new Evaluated(value.get("versions"), decisions);
    }

    private static ObjectNode chargingFact(JsonNode charging, long briefVersion, String asOf) {
        boolean known = charging != null && "confirmed".equals(charging.path("state").asText(null))
                && charging.has("value") && !charging.get("value").isNull();
        ObjectNode out = JSON.objectNode();
        out.put("status", known ? "known" : "unknown");
        if (charging != null && charging.has("value")) out.set("value", charging.get("value")); else out.putNull("value");
        out.putNull("unit");
        ObjectNode provenance = out.putObject("provenance");
        provenance.put("sourceRef", charging != null && charging.path("source").isTextual() ? charging.get("source").textValue() : "brief:unresolved");
        provenance.put("version", Long.toString(briefVersion));
        provenance.put("observedAt", asOf);
        provenance.put("assurance", "synthetic-scenario");
        return out;
    }

    // Node entryOf: the stock row's own version is the availability version.
    private static ObjectNode entry(EligibleCandidates.Car car) {
        ObjectNode out = JSON.objectNode();
        out.put("orderUuid", car.orderUuid());
        out.put("configurationId", car.configurationId());
        out.set("snapshot", car.attributes().get("facts"));
        out.set("availability", availability(car));
        return out;
    }

    private static ObjectNode availability(EligibleCandidates.Car car) {
        ObjectNode a = car.attributes().path("release").path("availability").deepCopy();
        a.put("state", "available");
        a.put("version", Long.toString(car.version()));
        return a;
    }

    private static Decision decision(JsonNode d, EligibleCandidates.Car car, EligibleCandidates.Car rep, ObjectNode quoteFacts) {
        boolean own = car == rep;
        String gate = d.get("gateStatus").textValue();
        JsonNode score = d.get("score");
        JsonNode versions = d.get("versions");
        if (!own) {
            ObjectNode v = ((ObjectNode) versions).deepCopy();
            v.put("availability", Long.toString(car.version()));
            versions = v;
        }
        ObjectNode quote = null;
        if ("eligible".equals(gate)) {
            quote = JSON.objectNode();
            quote.put("orderUuid", car.orderUuid());
            quote.put("configurationId", car.configurationId());
            JsonNode snapshot = d.get("snapshot");
            if (!own) {
                ObjectNode copy = ((ObjectNode) snapshot).deepCopy();
                JsonNode mine = car.attributes().get("facts");
                copy.set("candidateKey", mine.get("candidateKey"));
                copy.set("sourceKeys", mine.get("sourceKeys"));
                snapshot = copy;
            }
            quote.set("snapshot", snapshot);
            quote.set("terms", d.get("terms"));
            quote.set("employeeFacts", quoteFacts);
            quote.set("versions", versions);
            quote.set("reasons", d.get("reasons"));
            quote.set("tradeOffs", d.get("tradeOffs"));
        }
        return new Decision(car.orderUuid(), gate, score == null || !score.isNumber() ? null : score.doubleValue(),
                d.get("reasons"), d.get("blockers"), d.get("unknowns"), versions, quote);
    }
}
