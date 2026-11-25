package gcsp.api.scenario;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.brief.BriefResult;
import gcsp.api.brief.BriefScope;
import gcsp.api.brief.BriefService;
import gcsp.api.clock.ClockResult;
import gcsp.api.clock.RunClock;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;

/** Main's frozen input only: actual brief commands, with no released stock, holds, offers or notifications. */
final class MainJourneyStart {

    static final String SCENARIO_ID = "main-successful-journey";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private final BriefService briefs;
    private final PolicyService policy;
    private final RunClock clock;
    private final DemoPreparationFile file;

    MainJourneyStart(BriefService briefs, PolicyService policy, RunClock clock, DemoPreparationFile file) {
        this.briefs = briefs;
        this.policy = policy;
        this.clock = clock;
        this.file = file;
    }

    ClockResult load(RunContext run, ScenarioCatalogue.Entry scenario) {
        if (scenario.mechanics()) return ClockResult.ok(F.objectNode());
        if (!SCENARIO_ID.equals(scenario.scenarioId())) return unavailable("scenario-loader-unavailable");
        var time = clock.now(run.environmentId(), run.runId());
        if (time.isEmpty()) return unavailable("scenario-clock-unavailable");
        PolicyRead current = new PolicyRead(run.runId(), time.get().now().toString(), null);
        PolicyResult active = policy.getActiveVersion(current);
        if (!active.ok()) return unavailable("scenario-brief-policy-unavailable");
        PolicyRead read = new PolicyRead(run.runId(), current.asOf(), active.policyVersion());
        JsonNode input = file.scenario(SCENARIO_ID).orElseThrow().path("inputs").path("briefs").get(0);
        String employee = file.person(input.path("principalId").asText()).orElseThrow().path("employeeId").asText();
        ObjectNode content = content(policy, read, input, "scenario:" + SCENARIO_ID);
        if (content == null) return unavailable("scenario-brief-policy-unavailable");
        BriefScope scope = new BriefScope(run.environmentId(), run.runId(), employee,
                input.path("principalId").asText(), active.policyVersion());
        ObjectNode draft = F.objectNode().put("commandId", "scenario-start:main:draft")
                .put("expectedBriefVersion", 0).put("expectedDraftVersion", 0);
        draft.set("brief", content);
        BriefResult saved = briefs.saveDraft(scope, draft);
        if (!(saved instanceof BriefResult.Ok)) return failure(saved);
        ObjectNode confirm = F.objectNode().put("commandId", "scenario-start:main:confirm")
                .put("expectedBriefVersion", 0).put("expectedDraftVersion", 1);
        confirm.set("consent", input.path("consent").deepCopy());
        BriefResult confirmed = briefs.confirmWithoutGate(scope, confirm);
        return confirmed instanceof BriefResult.Ok ? ClockResult.ok(F.objectNode().put("briefVersion", 1)) : failure(confirmed);
    }

    /** Values are frozen scenario inputs; essential operators and units stay owned by the pinned policy. */
    static ObjectNode content(PolicyService policy, PolicyRead read, JsonNode input, String source) {
        PolicyResult recommendation = policy.getAssumption("employee.recommendation.v1", read);
        PolicyResult lifecycle = policy.getAssumption("brief.lifecycle.v1", read);
        if (!recommendation.ok() || !lifecycle.ok()) return null;
        ObjectNode content = F.objectNode().put("schemaVersion", 1);
        ObjectNode preferences = content.putObject("preferences");
        input.path("preferences").properties().forEach(p -> {
            ObjectNode value = preferences.putObject(p.getKey()).put("valueState", "confirmed")
                    .put("importanceState", "confirmed").put("source", source);
            value.set("value", p.getValue().path("value").deepCopy());
            value.set("importance", p.getValue().path("importance").deepCopy());
        });
        ObjectNode essentials = content.putObject("essentials");
        for (var entry : input.path("essentials").properties()) {
            JsonNode definition = "charging".equals(entry.getKey())
                    ? lifecycle.value().path("value").path("charging")
                    : recommendation.value().path("value").path("essentials").path(entry.getKey());
            if (!definition.has("operator") || !definition.has("unit")) return null;
            ObjectNode value = essentials.putObject(entry.getKey()).put("state", "confirmed").put("source", source);
            value.set("value", entry.getValue().deepCopy());
            value.set("operator", definition.get("operator").deepCopy());
            value.set("unit", definition.get("unit").deepCopy());
        }
        return content;
    }

    private static ClockResult failure(BriefResult result) {
        if (result instanceof BriefResult.Refusal r && "stale-run".equals(r.code())) return ClockResult.staleRun();
        return unavailable(result instanceof BriefResult.Refusal r ? r.code() : "scenario-brief-unavailable");
    }

    private static ClockResult unavailable(String code) {
        return ClockResult.unavailable(code, "The scenario starting brief could not be prepared.", true);
    }
}
