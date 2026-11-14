package gcsp.api.supply;

import java.time.Instant;
import java.util.function.Function;

/** Scriptable policy and provider doubles for the release tests. */
final class Stubs {

    private Stubs() {}

    static final class Policy implements ReleasePolicy {
        volatile PolicyReading reading;

        Policy(int size, int leadDays) {
            reading = new PolicyReading.Ok("test-policy-v1", size, leadDays, 60);
        }

        @Override
        public PolicyReading read(String runId, Instant asOf) {
            return reading;
        }
    }

    static final class Provider implements SupplyProvider {
        volatile Function<PullRequest, ProviderResponse> behaviour;
        volatile int calls;

        Provider(Function<PullRequest, ProviderResponse> behaviour) {
            this.behaviour = behaviour;
        }

        @Override
        public String mode() {
            return "stub";
        }

        @Override
        public ProviderResponse pull(PullRequest request) {
            calls++;
            return behaviour.apply(request);
        }
    }
}
