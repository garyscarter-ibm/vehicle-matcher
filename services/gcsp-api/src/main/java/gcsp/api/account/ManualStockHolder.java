package gcsp.api.account;

import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import gcsp.api.recommendation.AccountClockRecommendationClock;
import gcsp.api.recommendation.VehicleEvidencePort;
import gcsp.api.supply.SupplyRelease;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Optional;

/** Builds the one ManualStock lazily; empty without persistence or a configured account provider. */
@ApplicationScoped
public class ManualStockHolder {

    @Inject
    Persistence persistence;

    @Inject
    AccountSelection selection;

    @Inject
    AccountService accounts;

    @Inject
    ManualDraftsHolder drafts;

    @Inject
    PolicyService policy;

    @Inject
    SupplyRelease supply;

    @Inject
    VehicleEvidencePort evidence;

    @Inject
    AccountClockPort clock;

    private ManualStock stock;

    public synchronized Optional<ManualStock> stock() {
        if (!persistence.active() || !selection.configured()) return Optional.empty();
        if (stock == null) {
            ManualDrafts manual = drafts.drafts().orElseThrow();
            stock = new ManualStock(accounts, manual, policy, supply.stock()::page, evidence,
                    new AccountClockRecommendationClock(clock, persistence.guard()::currentRun));
        }
        return Optional.of(stock);
    }
}
