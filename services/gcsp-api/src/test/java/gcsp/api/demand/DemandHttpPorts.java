package gcsp.api.demand;

import gcsp.api.demand.DemandPolicyPort.DemandPolicy;
import gcsp.api.demand.UnmetEvaluationPort.BriefCandidate;
import gcsp.api.demand.UnmetEvaluationPort.Evaluation;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.sql.Connection;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Test port beans for the demand HTTP profiles: the retained Node seed policy, an all-eligible evaluator and no offers. */
public final class DemandHttpPorts {

    private DemandHttpPorts() {}

    @Alternative
    @ApplicationScoped
    public static class SeedPolicy implements DemandPolicyPort {
        private final DemandFixture.Policy delegate = new DemandFixture.Policy();

        @Override
        public Optional<DemandPolicy> read(String policyVersion, Instant asOf) {
            return delegate.read(policyVersion, asOf);
        }
    }

    @Alternative
    @ApplicationScoped
    public static class EligibleEvaluation implements UnmetEvaluationPort {
        private final DemandFixture.Evaluator delegate = new DemandFixture.Evaluator();

        @Override
        public Evaluation evaluate(DemandScope scope, List<BriefCandidate> candidates, Instant asOf) {
            return delegate.evaluate(scope, candidates, asOf);
        }
    }

    @Alternative
    @ApplicationScoped
    public static class EmptyOffers implements OfferRecordsPort {
        @Override
        public Optional<OfferRecords> read(Connection snapshot, DemandScope scope) {
            return Optional.of(new OfferRecords(List.of(), List.of()));
        }
    }
}
