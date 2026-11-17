package gcsp.api.production;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.planning.PlanningClock;
import gcsp.api.planning.PlanningDemand;
import gcsp.api.planning.PlanningRead;
import gcsp.api.planning.PlanningSupply;
import gcsp.api.policy.PolicyService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.time.Instant;
import java.util.List;

/** Planner inputs for the journey: a small synthetic demand and stock over the seed catalogue, and a fixed clock. */
public final class ProductionPlanPorts {

    static final Instant NOW = Instant.parse("2026-11-06T00:00:00.000Z");
    static final String SALOON_330E = "g20-saloon-330e";
    private static final ObjectMapper M = new ObjectMapper();

    private ProductionPlanPorts() {}

    /** Demand wants a 330e, a Touring and an i5; one Touring is in stock. The tests move the stock version. */
    @Alternative
    @ApplicationScoped
    public static class Inputs implements PlanningDemand, PlanningSupply {
        private volatile String stockVersion = "stock-v1";

        /** A method, not a field, because tests hold a client proxy. */
        public void stockVersion(String version) {
            this.stockVersion = version;
        }

        @Override
        public ObjectNode readForecast(PlanningRead read, PolicyService policy) {
            ObjectNode out = M.createObjectNode().put("status", "ok").put("contractVersion", "1.0.0");
            ObjectNode v = out.putObject("value");
            v.put("runId", read.runId()).put("asOf", read.asOf()).put("policyVersion", read.policyVersion());
            v.put("version", "forecast-v1").put("cohortVersion", "cohort-v1");
            ObjectNode f = v.putObject("forecast");
            f.put("basis", "expressed-saved-demand").put("horizonEnd", read.horizonEnd());
            ArrayNode ents = f.putArray("entitlements");
            ents.add(entitlement(1, SALOON_330E));
            ents.add(entitlement(2, "g21-touring-320i"));
            ents.add(entitlement(3, "g61-i5-40"));
            f.putArray("limitations").add("Fixture demand.");
            return out;
        }

        @Override
        public ObjectNode readSupply(PlanningRead read, PolicyService policy) {
            ObjectNode out = M.createObjectNode().put("status", "ok").put("contractVersion", "1.0.0");
            ObjectNode v = out.putObject("value");
            v.put("runId", read.runId()).put("asOf", read.asOf());
            ObjectNode versions = v.putObject("versions");
            versions.put("stock", stockVersion).put("supply", "supply-v1");
            versions.put("catalog", read.policyVersion() + ":order-plan-catalog.v1");
            v.putArray("stock").add(car("veh-1", "g21-touring-320i"));
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

        private static ObjectNode car(String id, String derivativeId) {
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

    /** A fixed instant, so two reads of unchanged inputs give the same plan id. */
    @Alternative
    @ApplicationScoped
    public static class FixedClock implements PlanningClock {
        @Override
        public Observation observe(RunContext context) {
            return new Observation(NOW, "fixed-clock");
        }
    }
}
