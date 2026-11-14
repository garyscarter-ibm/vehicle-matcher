package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountPolicyPort.PolicyOutcome;
import gcsp.api.account.AccountPolicyPort.PolicyRead;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/** A Node golden turned into port doubles that supply only its facts; tests mutate the facts then call service(). */
final class GoldenFixture {

    static final ObjectMapper JSON = new ObjectMapper();

    final String name;
    final JsonNode golden;
    final AccountScope scope;
    final String now;
    ObjectNode input;
    PolicyOutcome manualRules;
    PolicyOutcome schemeNames;
    PolicyOutcome allowance;
    SourceResult employment;
    SourceResult cars = SourceResult.ok(JSON.createArrayNode());
    Function<ObjectNode, SourceResult> contractReader;
    Function<ObjectNode, SourceResult> driverReader;
    AccountClockPort clock;

    GoldenFixture(String name) {
        this.name = name;
        try (InputStream in = GoldenFixture.class.getResourceAsStream("/account/node-baseline/" + name + ".json")) {
            golden = JSON.readTree(in);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        JsonNode c = golden.get("context");
        List<String> roles = new ArrayList<>();
        c.get("roles").forEach(r -> roles.add(r.asText()));
        scope = new AccountScope(c.get("environmentId").asText(), c.get("runId").asText(), c.get("employeeId").asText(),
                c.get("name").asText(), roles, c.get("companyId").asText(), c.get("schemeId").asText(),
                c.get("gradeId").asText(), c.get("entitlementSlotId").asText(), c.get("policyVersion").asText());
        now = golden.get("now").asText();
        input = golden.get("input").deepCopy();
        JsonNode p = golden.get("policy");
        manualRules = outcome(p.get("manualContext"));
        schemeNames = outcome(p.get("schemeDisplayNames"));
        allowance = outcome(p.get("allowance"));
        employment = SourceResult.ok(JSON.createObjectNode().put("name", scope.name()).put("companyId", scope.companyId())
                .put("schemeId", scope.schemeId()).put("gradeId", scope.gradeId())
                .put("entitlementSlotId", scope.entitlementSlotId()));
        contractReader = this::contractFacts;
        driverReader = this::driverFacts;
        clock = s -> new AccountClockPort.ClockReading(now, "1");
    }

    static PolicyOutcome outcome(JsonNode o) {
        return new PolicyOutcome(o.get("status").asText(), o.has("code") ? o.get("code").asText() : null,
                o.has("policyVersion") ? o.get("policyVersion").asText() : null, o.get("value"));
    }

    /** What Node's repository ports return for employeeContract.read. */
    private SourceResult contractFacts(ObjectNode in) {
        JsonNode m = in.get("manualContext");
        if (m == null || m.isNull()) return SourceResult.notFound();
        ObjectNode v = base(m, in);
        v.remove(List.of("drivers", "employeeFacts"));
        v.set("slots", in.get("slots"));
        return SourceResult.ok(v);
    }

    /** What Node's repository ports return for driver.read. */
    SourceResult driverFacts(ObjectNode in) {
        JsonNode m = in.get("manualContext");
        if (m == null || m.isNull()) return SourceResult.notFound();
        ObjectNode v = JSON.createObjectNode();
        v.put("runId", scope.runId()).put("environmentId", scope.environmentId()).put("employeeId", scope.employeeId());
        for (String key : List.of("recordSetId", "source", "drivers", "employeeFacts")) v.set(key, m.get(key));
        v.set("repositoryVersion", in.get("employeeVersion"));
        return SourceResult.ok(v);
    }

    private ObjectNode base(JsonNode m, ObjectNode in) {
        ObjectNode v = JSON.createObjectNode();
        v.put("runId", scope.runId()).put("environmentId", scope.environmentId()).put("employeeId", scope.employeeId());
        v.setAll((ObjectNode) m.deepCopy());
        v.set("repositoryVersion", in.get("employeeVersion"));
        return v;
    }

    ObjectNode manual() {
        return (ObjectNode) input.get("manualContext");
    }

    ObjectNode rulesPayload() {
        return (ObjectNode) manualRules.value().get("value");
    }

    AccountService service() {
        return service(nodeShapedRecords());
    }

    AccountService service(AccountRecordsPort records) {
        AccountPolicyPort policy = new AccountPolicyPort() {
            public PolicyOutcome manualRules(PolicyRead r) {
                return manualRules;
            }

            public PolicyOutcome allowance(AccountScope s, PolicyRead r) {
                return allowance;
            }

            public PolicyOutcome schemeDisplayNames(PolicyRead r) {
                return schemeNames;
            }
        };
        return new AccountService(records, policy, s -> clock.now(s), s -> cars);
    }

    private AccountRecordsPort nodeShapedRecords() {
        return new AccountRecordsPort() {
            public SourceResult readEmployeeContract(AccountScope s) {
                return contractReader.apply(input);
            }

            public SourceResult readDrivers(AccountScope s) {
                return driverReader.apply(input);
            }

            public SourceResult readEmployment(String environmentId, String runId, String employeeId) {
                return employment;
            }
        };
    }

    AccountOutcome read() {
        return service().readAccount(scope);
    }

    static ArrayNode array(JsonNode... items) {
        ArrayNode a = JSON.createArrayNode();
        for (JsonNode i : items) a.add(i);
        return a;
    }
}
