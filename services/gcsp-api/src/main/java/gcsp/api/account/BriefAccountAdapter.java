package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import gcsp.api.brief.BriefAccountPort;
import gcsp.api.persistence.Canonical;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Serves the brief's account facts from the same account projection; any refusal is "unavailable" (empty). */
@ApplicationScoped
public class BriefAccountAdapter implements BriefAccountPort {

    private final AccountService service;
    private final Optional<String> policyVersion;

    @Inject
    public BriefAccountAdapter(AccountService service,
            @ConfigProperty(name = "gcsp.environment.policy-version") Optional<String> policyVersion) {
        this.service = service;
        this.policyVersion = policyVersion.filter(v -> !v.isBlank());
    }

    @Override
    public Optional<AccountFacts> facts(String environmentId, String runId, String employeeId) {
        if (policyVersion.isEmpty()) return Optional.empty();
        AccountOutcome outcome = service.readAccount(new AccountScope(environmentId, runId, employeeId, null,
                List.of("employee"), null, null, null, null, policyVersion.get()));
        if (!outcome.isOk()) return Optional.empty();
        JsonNode v = outcome.value();
        JsonNode c = v.path("currentContract");
        CurrentContract car = c.isObject() && c.path("contractId").isTextual()
                ? new CurrentContract(c.get("contractId").textValue(), c.path("model").isTextual() ? c.get("model").textValue() : null)
                : null;
        // Absent or policy-unknown states carry no contextVersion, so version the state itself.
        String version = v.path("contextVersion").isTextual() ? v.get("contextVersion").textValue()
                : Canonical.digest(JsonNodeFactory.instance.objectNode().put("runId", runId)
                        .put("employeeId", employeeId).put("state", v.path("state").asText()));
        return Optional.of(new AccountFacts(car, version));
    }
}
