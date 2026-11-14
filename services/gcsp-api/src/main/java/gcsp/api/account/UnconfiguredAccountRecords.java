package gcsp.api.account;

/** Provider "none": every read is a source failure; the endpoint answers before reaching it. */
final class UnconfiguredAccountRecords implements AccountRecordsPort {

    static final String CODE = "account-provider-not-configured";

    @Override
    public SourceResult readEmployeeContract(AccountScope scope) {
        return SourceResult.unavailable(CODE);
    }

    @Override
    public SourceResult readDrivers(AccountScope scope) {
        return SourceResult.unavailable(CODE);
    }

    @Override
    public SourceResult readEmployment(String environmentId, String runId, String employeeId) {
        return SourceResult.unavailable(CODE);
    }
}
