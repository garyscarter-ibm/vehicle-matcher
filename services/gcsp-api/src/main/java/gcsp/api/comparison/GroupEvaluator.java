package gcsp.api.comparison;

import static gcsp.api.comparison.ReplayRecords.JSON;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;
import gcsp.api.recommendation.RecommendationClock;
import gcsp.api.recommendation.RecommendationSource;
import gcsp.api.recommendation.StoredSubjectEvaluator;
import java.util.List;
import java.util.function.Supplier;

/** Java's stored-subject evaluator over one car per group with static availability, as the Node provider and time objects. */
final class GroupEvaluator {

    private final String runId;
    private final String inputHash;
    private final String startsAt;
    private final String policyVersion;
    private final String factsVersion;
    private final ArrayNode stock = JSON.arrayNode();
    private final JsonNode adapterRow;
    private final StoredSubjectEvaluator evaluator;
    private ObjectNode facts;

    /** now supplies the evaluation instant (ISO); the seed evaluation pins it to startsAt, a run uses its virtual clock. */
    GroupEvaluator(ComparisonInputs inputs, PolicyService policy, JsonNode adapterRow, ReplayStock.Groups groups,
            List<ReplayStock.Row> rows, Supplier<String> now) {
        ObjectNode manifest = inputs.manifest();
        this.inputHash = manifest.get("inputHash").textValue();
        this.runId = "comparison-evaluation-" + inputHash.substring(0, 24);
        this.startsAt = manifest.get("startsAt").textValue();
        this.policyVersion = manifest.get("policyVersion").textValue();
        this.adapterRow = adapterRow;
        this.factsVersion = adapterRow.get("policyVersion").textValue() + ":" + adapterRow.get("value").get("fixtureVersion").textValue();
        String until = rows.isEmpty() ? startsAt : rows.get(0).availability().get("availableUntil").textValue();
        for (ReplayStock.Group group : groups.list()) {
            ReplayStock.Row row = group.representative();
            ObjectNode entry = stock.addObject();
            entry.put("orderUuid", row.orderUuid());
            entry.put("configurationId", row.configurationId());
            entry.set("snapshot", row.snapshot());
            ObjectNode availability = entry.putObject("availability");
            availability.put("state", "available");
            availability.put("availableFrom", startsAt);
            availability.put("availableUntil", until);
            availability.put("version", "comparison-static:" + inputHash);
        }
        RecommendationSource source = context -> {
            ObjectNode out = JSON.objectNode();
            out.put("status", "ok");
            ObjectNode body = out.putObject("value");
            body.put("runId", context.runId());
            body.put("environmentId", runId);
            body.put("employeeId", context.employeeId());
            body.put("factsVersion", factsVersion);
            body.put("stockVersion", "comparison-static:" + inputHash);
            body.set("employeeFacts", facts);
            body.set("stock", stock);
            return out;
        };
        RecommendationClock time = context -> {
            ObjectNode out = JSON.objectNode();
            out.put("status", "ok");
            ObjectNode body = out.putObject("value");
            body.put("runId", context.runId());
            body.put("now", now.get());
            body.put("clockVersion", "comparison-static-evaluation");
            return out;
        };
        this.evaluator = new StoredSubjectEvaluator(source, policy, time);
    }

    String runId() {
        return runId;
    }

    /** One evaluation of the employee's facts and the given brief against every group. */
    ObjectNode evaluate(JsonNode employee, JsonNode brief) {
        ObjectNode subject = JSON.objectNode();
        subject.put("runId", runId);
        subject.put("environmentId", runId);
        subject.set("employeeId", employee.get("employeeId"));
        subject.set("companyId", employee.get("companyId"));
        subject.set("schemeId", employee.get("schemeId"));
        subject.set("gradeId", employee.get("gradeId"));
        subject.put("policyVersion", policyVersion);
        ObjectNode employeeFacts = ReplayRecords.employeeFacts(employee, adapterRow, startsAt);
        employeeFacts.set("driverEligible", ReplayRecords.driverFact(adapterRow, startsAt));
        facts = employeeFacts;
        return evaluator.evaluate(subject, brief);
    }
}
