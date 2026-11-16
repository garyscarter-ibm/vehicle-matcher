package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountClockPort;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.AccountService;
import gcsp.api.account.SourceResult;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyAccountAdapter;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import gcsp.api.supply.ReleasedCar;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** In-memory ports for the source tests: Node account goldens as records, Node stock rows as released cars. */
final class SourceFixture {

    static final String ENV = "test-app-env";
    static final String RUN = "run-1";
    static final String NOW = "2026-11-05T09:00:00.000Z";

    private SourceFixture() {}

    static PolicyService policy() {
        return new PolicyService(new RetainedFilePolicySource());
    }

    static RecommendationContext context(String golden) throws IOException {
        JsonNode c = RecommendationDb.golden(golden).get("context");
        return new RecommendationContext(RUN, ENV, c.get("employeeId").asText(), c.get("companyId").asText(),
                c.get("schemeId").asText(), c.get("gradeId").asText(), c.get("policyVersion").asText(), List.of("employee"),
                c.get("entitlementSlotId").asText());
    }

    static RecommendationClock clock() {
        return context -> new Js.B().s("status", "ok").s("value", new Js.B().s("now", NOW).s("runId", context.runId())
                .s("clockVersion", "fixed").build()).s("contractVersion", "1.0.0").build();
    }

    static AccountRecordsPort records(String golden) throws IOException {
        JsonNode g = RecommendationDb.golden(golden);
        JsonNode ctx = g.get("context");
        JsonNode record = g.get("input").get("manualContext");
        return new AccountRecordsPort() {
            public SourceResult readEmployeeContract(AccountScope s) {
                ObjectNode v = base(s);
                v.setAll((ObjectNode) record.deepCopy());
                v.remove(List.of("drivers", "employeeFacts"));
                ArrayNode slots = v.putArray("slots");
                for (JsonNode slot : g.get("input").get("slots")) slots.add(((ObjectNode) slot.deepCopy()).put("runId", s.runId()));
                return SourceResult.ok(v);
            }

            public SourceResult readDrivers(AccountScope s) {
                ObjectNode v = base(s);
                for (String key : List.of("recordSetId", "source", "drivers", "employeeFacts")) v.set(key, record.get(key));
                return SourceResult.ok(v);
            }

            public SourceResult readEmployment(String environmentId, String runId, String employeeId) {
                return SourceResult.ok(RecommendationDb.JSON.createObjectNode().put("name", ctx.get("name").asText())
                        .put("companyId", ctx.get("companyId").asText()).put("schemeId", ctx.get("schemeId").asText())
                        .put("gradeId", ctx.get("gradeId").asText()).put("entitlementSlotId", ctx.get("entitlementSlotId").asText()));
            }

            private ObjectNode base(AccountScope s) {
                ObjectNode v = RecommendationDb.JSON.createObjectNode();
                v.put("runId", s.runId()).put("environmentId", s.environmentId()).put("employeeId", s.employeeId());
                v.set("repositoryVersion", g.get("input").get("employeeVersion"));
                return v;
            }
        };
    }

    static AccountService accounts(AccountRecordsPort records, PolicyService policy) {
        AccountClockPort clock = s -> new AccountClockPort.ClockReading(NOW, "fixed");
        return new AccountService(records, new PolicyAccountAdapter(policy), clock,
                s -> SourceResult.ok(RecommendationDb.JSON.createArrayNode()));
    }

    static ReleasedStockRecommendationSource source(String golden, StockPages pages, VehicleEvidencePort evidence)
            throws IOException {
        AccountRecordsPort records = records(golden);
        return new ReleasedStockRecommendationSource(accounts(records, policy()), records, pages, evidence, clock());
    }

    /** Node stock rows as the allocator reads them: typed columns split out; held or allocated means an occupying hold. */
    static List<ReleasedCar> cars(JsonNode rows) {
        List<ReleasedCar> out = new ArrayList<>();
        for (JsonNode row : rows) {
            ObjectNode attributes = ((ObjectNode) row).deepCopy();
            attributes.remove(List.of("orderUuid", "configurationId", "state", "available", "held", "allocated", "version"));
            boolean occupied = row.path("held").asBoolean() || row.path("allocated").asBoolean();
            out.add(new ReleasedCar(row.get("orderUuid").asText(), row.get("configurationId").asText(),
                    row.get("version").asLong(), attributes, occupied));
        }
        out.sort((a, b) -> a.orderUuid().compareTo(b.orderUuid()));
        return out;
    }

    /** A list-backed keyset pager that counts the pages it serves. */
    static final class Pager implements StockPages {
        final List<ReleasedCar> all;
        int pages;
        final List<Integer> limits = new ArrayList<>();

        Pager(List<ReleasedCar> all) {
            this.all = all;
        }

        public List<ReleasedCar> page(RunContext scope, String after, int limit) {
            pages++;
            limits.add(limit);
            return all.stream().filter(c -> after == null || c.orderUuid().compareTo(after) > 0).limit(limit).toList();
        }
    }
}
