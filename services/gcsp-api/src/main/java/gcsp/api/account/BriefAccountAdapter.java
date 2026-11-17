package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
    private final AccountRecordsPort records;
    private final Optional<String> policyVersion;

    @Inject
    public BriefAccountAdapter(AccountService service, AccountRecordsPort records,
            @ConfigProperty(name = "gcsp.environment.policy-version") Optional<String> policyVersion) {
        this.service = service;
        this.records = records;
        this.policyVersion = policyVersion.filter(v -> !v.isBlank());
    }

    @Override
    public Optional<AccountFacts> facts(String environmentId, String runId, String employeeId) {
        if (policyVersion.isEmpty()) return Optional.empty();
        AccountScope scope = new AccountScope(environmentId, runId, employeeId, null,
                List.of("employee"), null, null, null, null, policyVersion.get());
        AccountOutcome outcome = service.readAccount(scope);
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
        // An absent HR account has no provider facts to show, so it keeps the car-only editor facts.
        Known known = null;
        if (v.path("account").isObject()) {
            SourceResult read = records.readDrivers(scope);
            if (!read.isOk()) return Optional.empty();
            known = known(v, read.value());
        }
        return Optional.of(new AccountFacts(car, version, known));
    }

    private static Known known(JsonNode v, JsonNode drivers) {
        ObjectNode digestInput = JsonNodeFactory.instance.objectNode();
        digestInput.set("driver", orNull(drivers.get("source")));
        digestInput.set("recordSetId", orNull(drivers.get("recordSetId")));
        digestInput.set("repositoryVersion", orNull(drivers.get("repositoryVersion")));
        JsonNode versions = v.get("versions");
        return new Known(v.get("account"), v.get("currentContract"), v.get("drivers"), versions,
                v.path("contextVersion").isTextual() ? v.get("contextVersion").textValue() : null,
                versions != null && versions.path("clock").isTextual() ? versions.get("clock").textValue() : null,
                drivers.get("employeeFacts"), Canonical.digest(digestInput));
    }

    private static JsonNode orNull(JsonNode n) {
        return n == null ? JsonNodeFactory.instance.nullNode() : n;
    }
}
