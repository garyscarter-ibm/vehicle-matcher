package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/** Small synthetic demand and supply over the seed catalogue ids, and a Greg principal on the seed policy version. */
final class PlanningFixtures {

    static final ObjectMapper M = new ObjectMapper();
    static final String RUN = "run-1";
    static final String POLICY = "gcsp-policy-v1";
    static final Instant NOW = Instant.parse("2026-11-06T00:00:00.000Z");
    static final String TOURING = "g21-touring-320i";
    static final String SALOON = "g20-saloon-320i";
    static final String I5 = "g61-i5-40";

    private PlanningFixtures() {
    }

    static Principal principal(String... roles) {
        return new Principal("sub-greg", List.of(roles), "env-1", RUN, null, POLICY, List.of());
    }

    /** Mutable scripted demand and supply that count their reads; every call returns a fresh copy. */
    static class Ports implements PlanningDemand, PlanningSupply {
        final AtomicInteger demandReads = new AtomicInteger();
        final AtomicInteger supplyReads = new AtomicInteger();
        volatile ObjectNode demandOutcome;
        volatile ObjectNode supplyOutcome;
        volatile String demandVersion = "forecast-v1";
        volatile String stockVersion = "stock-v1";
        /** When set, the second and later demand reads report this version (a change during one compute). */
        volatile String laterDemandVersion;
        volatile String supplyCatalogOverride;
        volatile ArrayNode stock = M.createArrayNode();
        /** More than 128 entitlements is beyond the solver's limit. */
        volatile int extraEntitlements;

        @Override
        public ObjectNode readForecast(PlanningRead read, gcsp.api.policy.PolicyService policy) {
            int n = demandReads.incrementAndGet();
            if (demandOutcome != null) {
                return demandOutcome.deepCopy();
            }
            ObjectNode out = M.createObjectNode().put("status", "ok").put("contractVersion", "1.0.0");
            ObjectNode v = out.putObject("value");
            v.put("runId", read.runId()).put("asOf", read.asOf()).put("policyVersion", read.policyVersion());
            v.put("version", laterDemandVersion != null && n > 1 ? laterDemandVersion : demandVersion);
            v.put("cohortVersion", "cohort-v1");
            ObjectNode f = v.putObject("forecast");
            f.put("basis", "expressed-saved-demand").put("horizonEnd", read.horizonEnd());
            ArrayNode ents = f.putArray("entitlements");
            ents.add(entitlement(1, TOURING, SALOON));
            ents.add(entitlement(2, TOURING));
            ents.add(entitlement(3, I5));
            for (int i = 0; i < extraEntitlements; i++) {
                ents.add(entitlement(10 + i, TOURING));
            }
            f.putArray("limitations").add("Fixture demand.");
            return out;
        }

        @Override
        public ObjectNode readSupply(PlanningRead read, gcsp.api.policy.PolicyService policy) {
            supplyReads.incrementAndGet();
            if (supplyOutcome != null) {
                return supplyOutcome.deepCopy();
            }
            ObjectNode out = M.createObjectNode().put("status", "ok").put("contractVersion", "1.0.0");
            ObjectNode v = out.putObject("value");
            v.put("runId", read.runId()).put("asOf", read.asOf());
            ObjectNode versions = v.putObject("versions");
            versions.put("stock", stockVersion).put("supply", "supply-v1");
            versions.put("catalog", supplyCatalogOverride != null ? supplyCatalogOverride : read.policyVersion() + ":order-plan-catalog.v1");
            v.set("stock", stock.deepCopy());
            v.putArray("inbound");
            v.putArray("requests");
            v.putArray("responses");
            v.putObject("unboundStock").put("count", 0).putArray("models");
            return out;
        }

        private static ObjectNode entitlement(int n, String... acceptable) {
            ObjectNode e = M.createObjectNode();
            e.put("entitlementId", "ent-" + n).put("employeeId", "emp-" + n).put("renewalId", "ren-" + n);
            e.put("entitlementSlotId", "slot-" + n).put("companyId", "co-1").put("schemeId", "sch-1");
            e.put("renewalAt", "2027-01-20T00:00:00.000Z");
            ArrayNode a = e.putArray("acceptableDerivativeIds");
            List.of(acceptable).forEach(a::add);
            e.putArray("gates");
            return e;
        }

        static ObjectNode car(String id, String derivativeId) {
            ObjectNode c = M.createObjectNode();
            c.put("stockId", id).put("derivativeId", derivativeId).put("availableAt", "2026-11-01T00:00:00.000Z");
            c.putNull("heldForEntitlementSlotId");
            ObjectNode vis = c.putObject("visibility");
            vis.putArray("companyIds").add("co-1");
            vis.putArray("schemeIds").add("sch-1");
            vis.putNull("employeeIds");
            return c;
        }
    }

    static JsonNode json(String text) {
        try {
            return M.readTree(text);
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    static int quantity(JsonNode plan, String derivativeId) {
        for (JsonNode q : plan.get("quantities")) {
            if (derivativeId.equals(q.get("derivativeId").textValue())) {
                return q.get("quantity").intValue();
            }
        }
        throw new IllegalStateException(derivativeId);
    }
}
