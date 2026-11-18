package gcsp.api.brief;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountClockPort;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountSelection;
import gcsp.api.account.AccountService;
import gcsp.api.account.CurrentCarPort;
import gcsp.api.account.SourceResult;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyAccountAdapter;
import gcsp.api.policy.PolicyService;
import gcsp.api.recommendation.AccountClockRecommendationClock;
import gcsp.api.recommendation.RecommendationContext;
import gcsp.api.recommendation.RecommendationService;
import gcsp.api.recommendation.ReleasedStockRecommendationSource;
import gcsp.api.recommendation.VehicleEvidencePort;
import gcsp.api.supply.SupplyRelease;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;

/** The production preview port: the same recommendation wiring as the recommendations route, over the employee scope. */
@DefaultBean
@ApplicationScoped
public class RecommendationBriefPreview implements BriefPreviewPort {

    @Inject
    Persistence persistence;

    @Inject
    AccountSelection selection;

    @Inject
    CurrentCarPort currentCars;

    @Inject
    AccountRecordsPort records;

    @Inject
    AccountClockPort accountClock;

    @Inject
    PolicyService policy;

    @Inject
    SupplyRelease supply;

    @Inject
    VehicleEvidencePort evidence;

    private AccountClockRecommendationClock clock;
    private RecommendationService service;

    @Override
    public ObjectNode preview(BriefScope scope, ObjectNode input) {
        if (!persistence.active() || !selection.configured()) return BriefPreviewPort.unconfigured();
        AccountClockRecommendationClock c = clock();
        RecommendationContext context = context(scope);
        if (context == null) {
            JsonNode stale = c.staleRun(scope.environmentId(), scope.runId());
            if (stale instanceof ObjectNode o) return o;
            ObjectNode o = BriefPreviewPort.unconfigured();
            o.put("code", "employee-context-unavailable").put("reason", "The employee scheme context could not be resolved.");
            return o;
        }
        return service(c).previewUnsaved(context, input);
    }

    /** Identity from the scope; scheme membership from the account's employment record. */
    private RecommendationContext context(BriefScope s) {
        SourceResult employment = records.readEmployment(s.environmentId(), s.runId(), s.employeeId());
        if (!employment.isOk()) return null;
        JsonNode e = employment.value();
        String[] keys = {"companyId", "schemeId", "gradeId", "entitlementSlotId"};
        String[] m = new String[4];
        for (int i = 0; i < keys.length; i++) m[i] = e.get(keys[i]) != null && e.get(keys[i]).isTextual() ? e.get(keys[i]).textValue() : null;
        return new RecommendationContext(s.runId(), s.environmentId(), s.employeeId(), m[0], m[1], m[2], s.policyVersion(),
                List.of("employee"), m[3]);
    }

    private synchronized AccountClockRecommendationClock clock() {
        if (clock == null) clock = new AccountClockRecommendationClock(accountClock, persistence.guard()::currentRun);
        return clock;
    }

    private synchronized RecommendationService service(AccountClockRecommendationClock c) {
        if (service == null) {
            AccountService accounts = new AccountService(records, new PolicyAccountAdapter(policy), accountClock, currentCars);
            service = new RecommendationService(new ReleasedStockRecommendationSource(accounts, records, supply.stock()::page,
                    evidence, c), policy, c);
        }
        return service;
    }
}
