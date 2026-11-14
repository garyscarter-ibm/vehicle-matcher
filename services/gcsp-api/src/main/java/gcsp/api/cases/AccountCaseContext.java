package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.SourceResult;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;

/** Serves the case renewal context from the account records; any failure other than "not found" is unavailable. */
@ApplicationScoped
public class AccountCaseContext implements CaseAccountPort {

    private final AccountRecordsPort records;

    @Inject
    public AccountCaseContext(AccountRecordsPort records) {
        this.records = records;
    }

    @Override
    public Lookup renewal(String environmentId, String runId, String employeeId) {
        try {
            SourceResult employment = records.readEmployment(environmentId, runId, employeeId);
            if (SourceResult.NOT_FOUND.equals(employment.status())) return Lookup.ok(null, null, null);
            if (!employment.isOk()) return Lookup.unavailable();
            JsonNode e = employment.value();
            String name = text(e, "name");
            String slotId = text(e, "entitlementSlotId");
            AccountScope scope = new AccountScope(environmentId, runId, employeeId, name, List.of("employee"),
                    text(e, "companyId"), text(e, "schemeId"), text(e, "gradeId"), slotId, null);
            SourceResult account = records.readEmployeeContract(scope);
            if (SourceResult.NOT_FOUND.equals(account.status())) return Lookup.ok(name, null, null);
            if (!account.isOk()) return Lookup.unavailable();
            JsonNode a = account.value();
            String renewalId = null;
            if (slotId != null && a.path("slots").isArray()) {
                for (JsonNode s : a.get("slots")) {
                    if (slotId.equals(text(s, "entitlementSlotId"))) {
                        renewalId = text(s, "renewalId");
                        break;
                    }
                }
            }
            String end = null;
            if (a.path("contracts").isArray()) {
                for (JsonNode c : a.get("contracts")) {
                    if ("current".equals(text(c, "status"))) {
                        end = text(c, "contractEndDate");
                        break;
                    }
                }
            }
            return Lookup.ok(name, renewalId, end);
        } catch (RuntimeException ex) {
            return Lookup.unavailable();
        }
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return v != null && v.isTextual() && !v.textValue().isBlank() ? v.textValue() : null;
    }
}
