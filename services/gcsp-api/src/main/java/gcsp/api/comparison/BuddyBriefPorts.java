package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import gcsp.api.account.AccountOutcome;
import gcsp.api.brief.BriefAccountPort;
import gcsp.api.brief.BriefAssumptions;
import gcsp.api.brief.BriefOfferPort;
import gcsp.api.brief.BriefPolicyPort;
import gcsp.api.persistence.Canonical;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** The brief service's three ports over the run: its policy, its account projection, and no offers (accept ends the brief). */
final class BuddyBriefPorts implements BriefPolicyPort, BriefAccountPort, BriefOfferPort {

    private final ReplayRun run;
    private final ReplaySelection selection;

    BuddyBriefPorts(ReplayRun run, ReplaySelection selection) {
        this.run = run;
        this.selection = selection;
    }

    @Override
    public Optional<BriefAssumptions> assumptions(String policyVersion) {
        PolicyRead read = new PolicyRead(run.runId, PolicyClock.iso(run.clock.now()), policyVersion);
        Map<String, JsonNode> entries = new LinkedHashMap<>();
        for (String key : BriefAssumptions.KEYS) {
            PolicyResult found = run.policy.getAssumption(key, read);
            if (!found.ok() || !policyVersion.equals(found.policyVersion())) return Optional.empty();
            entries.put(key, found.value().deepCopy());
        }
        return Optional.of(new BriefAssumptions(policyVersion, entries));
    }

    @Override
    public Optional<AccountFacts> facts(String environmentId, String runId, String employeeId) {
        AccountOutcome outcome = selection.account(employeeId);
        if (!outcome.isOk()) return Optional.empty();
        JsonNode v = outcome.value();
        JsonNode c = v.path("currentContract");
        CurrentContract car = c.isObject() && c.path("contractId").isTextual()
                ? new CurrentContract(c.get("contractId").textValue(), c.path("model").isTextual() ? c.get("model").textValue() : null)
                : null;
        String version = v.path("contextVersion").isTextual() ? v.get("contextVersion").textValue()
                : Canonical.digest(JsonNodeFactory.instance.objectNode().put("runId", runId)
                        .put("employeeId", employeeId).put("state", v.path("state").asText()));
        return Optional.of(new AccountFacts(car, version));
    }

    @Override
    public List<Offer> offers(String environmentId, String runId, String employeeId) {
        return List.of();
    }
}
