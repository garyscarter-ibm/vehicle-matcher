package gcsp.api.demand;

import gcsp.api.demand.AllocationRecordsPort.RecordedDecision;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import java.sql.Connection;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Production defaults until the real adapters exist: no data and no fallback, so a read is a truthful 503. */
public final class DemandDefaults {

    private DemandDefaults() {}

    @DefaultBean
    @ApplicationScoped
    public static class UnconfiguredPolicy implements DemandPolicyPort {
        @Override
        public Optional<DemandPolicy> read(String policyVersion, Instant asOf) {
            return Optional.empty();
        }
    }

    @DefaultBean
    @ApplicationScoped
    public static class UnconfiguredEvaluation implements UnmetEvaluationPort {
        @Override
        public Evaluation evaluate(DemandScope scope, List<BriefCandidate> candidates, Instant asOf) {
            return Evaluation.UNAVAILABLE;
        }
    }

    @DefaultBean
    @ApplicationScoped
    public static class UnconfiguredOffers implements OfferRecordsPort {
        @Override
        public Optional<OfferRecords> read(Connection snapshot, DemandScope scope) {
            return Optional.empty();
        }
    }

    /**
     * No Java allocation run has been recorded yet (the allocator is FUCQ-464), so nothing was evaluated and every
     * suitability cell reads not-evaluated; it is an empty result, not a failure.
     */
    @DefaultBean
    @ApplicationScoped
    public static class NoAllocationRecords implements AllocationRecordsPort {
        @Override
        public Optional<List<RecordedDecision>> read(Connection snapshot, DemandScope scope, List<String> employeeIds,
                List<String> orderUuids) {
            return Optional.of(List.of());
        }
    }
}
