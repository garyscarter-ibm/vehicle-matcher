package gcsp.api.claims;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.time.Instant;

/** Test ports, enabled only by the Selecting profile: every car is eligible with fixed facts and terms. */
public final class ClaimHttpPorts {

    static final ObjectMapper JSON = new ObjectMapper();
    static final ObjectNode TERMS = JSON.createObjectNode().put("points", 10);
    static final ObjectNode FACTS = JSON.createObjectNode().put("colour", "red");

    private ClaimHttpPorts() {}

    @Alternative
    @ApplicationScoped
    public static class Selection implements ManualSelectionPort {
        @Override
        public Claimant claimant(ClaimScope scope) {
            return new Known("slot-" + scope.employeeId(), "ctx-1", 1, "drv-1", scope.policyVersion());
        }

        @Override
        public Decision decide(ClaimScope scope, String orderUuid) {
            return new Eligible("cfg-1", FACTS.deepCopy(), TERMS.deepCopy(), Instant.now().plusSeconds(86_400));
        }
    }

    @Alternative
    @ApplicationScoped
    public static class Timing implements ClaimTimingPort {
        @Override
        public ClaimTimingPort.Timing timing(ClaimScope scope, Instant now) {
            return new Known(120, 600, JSON.createArrayNode());
        }
    }
}
