package gcsp.api.brief;

import java.util.Optional;

/** The employee's current car and the account facts version; only Same again and the rating read it. */
public interface BriefAccountPort {

    /** Empty when account facts are unavailable; a present result may still have no current contract. */
    Optional<AccountFacts> facts(String environmentId, String runId, String employeeId);

    record AccountFacts(CurrentContract currentContract, String factsVersion) {}

    record CurrentContract(String contractId, String model) {}
}
