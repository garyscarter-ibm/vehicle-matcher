package gcsp.api.account;

/**
 * Facts only, no decisions. The JSON shapes are the application contract: the same fields Node's repository
 * ports return for employeeContract.read and driver.read.
 */
public interface AccountRecordsPort {

    /** runId, environmentId, employeeId, recordSetId, source, account, contracts, histories, slots, repositoryVersion. */
    SourceResult readEmployeeContract(AccountScope scope);

    /** runId, environmentId, employeeId, recordSetId, source, drivers, employeeFacts, repositoryVersion. */
    SourceResult readDrivers(AccountScope scope);

    /** The employee's trusted scheme membership: name, companyId, schemeId, gradeId, entitlementSlotId. */
    SourceResult readEmployment(String environmentId, String runId, String employeeId);
}
