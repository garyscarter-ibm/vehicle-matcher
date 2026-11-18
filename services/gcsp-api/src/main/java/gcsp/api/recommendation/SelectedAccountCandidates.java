package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.SourceResult;
import gcsp.api.allocation.EligibleCandidates;
import java.util.List;

/**
 * Candidates over the selected account records: the caller's accountRecord is ignored, never a fallback. The two reads
 * must agree as AccountService and ReleasedStockRecommendationSource require (scope, recordSetId, repositoryVersion).
 */
public final class SelectedAccountCandidates implements EligibleCandidates {

    static final String UNAVAILABLE = "account-records-unavailable";
    static final String INCONSISTENT = "account-records-inconsistent";
    private static final List<String> CONTRACT_KEYS = List.of("recordSetId", "source", "account", "contracts", "histories");
    private static final List<String> DRIVER_KEYS = List.of("drivers", "employeeFacts");

    private final EligibleCandidates calculation;
    private final AccountRecordsPort records;

    public SelectedAccountCandidates(EligibleCandidates calculation, AccountRecordsPort records) {
        if (calculation == null || records == null) throw new IllegalArgumentException("calculation and records are required");
        this.calculation = calculation;
        this.records = records;
    }

    @Override
    public Result evaluate(Request request) {
        if (request == null || request.subject() == null) return calculation.evaluate(request);
        Subject subject = request.subject();
        JsonNode attributes = subject.employeeAttributes();
        AccountScope scope = new AccountScope(request.environmentId(), request.runId(), subject.employeeId(), null,
                List.of("employee"), string(attributes, "companyId"), string(attributes, "schemeId"),
                string(attributes, "gradeId"), subject.slotId(), request.policyVersion());
        SourceResult contract;
        SourceResult drivers;
        try {
            contract = records.readEmployeeContract(scope);
            if (contract == null || !contract.isOk()) return new Unavailable(UNAVAILABLE);
            drivers = records.readDrivers(scope);
            if (drivers == null || !drivers.isOk()) return new Unavailable(UNAVAILABLE);
        } catch (RuntimeException e) {
            return new Unavailable(UNAVAILABLE);
        }
        JsonNode c = contract.value();
        JsonNode d = drivers.value();
        if (!inScope(scope, c) || !inScope(scope, d) || !Js.text(c.get("recordSetId"))
                || !Js.strictEq(c.get("recordSetId"), d.get("recordSetId"))
                || (c.get("repositoryVersion") != null && d.get("repositoryVersion") != null
                        && !Js.strictEq(c.get("repositoryVersion"), d.get("repositoryVersion")))
                || d.get("drivers") == null || !d.get("drivers").isArray() || !Js.object(d.get("employeeFacts"))) {
            return new Unavailable(INCONSISTENT);
        }
        // The keys an employee_account_records row holds, so a repository read rebuilds the stored record.
        ObjectNode account = Js.obj();
        for (String key : CONTRACT_KEYS) if (c.has(key)) account.set(key, c.get(key).deepCopy());
        for (String key : DRIVER_KEYS) account.set(key, d.get(key).deepCopy());
        Subject selected = new Subject(subject.employeeId(), subject.slotId(), subject.employeeVersion(),
                subject.employeeAttributes(), account, subject.briefVersion(), subject.briefContent());
        return calculation.evaluate(new Request(request.environmentId(), request.runId(), request.policyVersion(),
                request.asOf(), request.clockVersion(), selected, request.cars()));
    }

    private static boolean inScope(AccountScope s, JsonNode v) {
        return Js.object(v) && Js.eqStr(Js.opt(v, "runId"), s.runId()) && Js.eqStr(Js.opt(v, "environmentId"), s.environmentId())
                && Js.eqStr(Js.opt(v, "employeeId"), s.employeeId());
    }

    private static String string(JsonNode node, String key) {
        JsonNode value = node == null ? null : node.get(key);
        return value != null && value.isTextual() ? value.textValue() : null;
    }
}
