package gcsp.api.production;

import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.util.Map;

/** Test plan port, enabled only by the production HTTP profiles; each test sets the plan Greg previewed. */
public final class ProductionHttpPorts {

    static final Map<String, String> VERSIONS = Map.of("forecast", "f1", "policy", "p1", "stock", "s1");

    private ProductionHttpPorts() {}

    @Alternative
    @ApplicationScoped
    public static class Plan implements PlanSnapshotPort {
        private volatile Reading reading = standard("plan-http-init");
        private volatile String planId = "plan-http-init";

        public void set(Reading reading) {
            this.reading = reading;
        }

        /** A fresh plan id each time, because one plan is sent to Production once per run. */
        public void reset() {
            planId = "plan-http-" + java.util.UUID.randomUUID();
            reading = standard(planId);
        }

        public String planId() {
            return planId;
        }

        /** Two lines: two 3 Series Saloons and one i5 Touring. */
        static Reading standard(String id) {
            return new PlanSnapshotPort.Snapshot(id, VERSIONS, true, ProductionFixture.T0, java.util.List.of(
                    new PlanSnapshotPort.Line("l1", "3 Series Saloon", "320i", 2),
                    new PlanSnapshotPort.Line("l2", "i5 Touring", "eDrive40", 1)));
        }

        @Override
        public String mode() {
            return "test";
        }

        @Override
        public Reading current(RunContext ctx) {
            return reading;
        }
    }
}
