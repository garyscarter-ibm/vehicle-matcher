package gcsp.api.brief;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;

/** The employee's current car and the account facts version; only Same again and the rating read it. */
public interface BriefAccountPort {

    /** Empty when account facts are unavailable; a present result may still have no current contract. */
    Optional<AccountFacts> facts(String environmentId, String runId, String employeeId);

    /** known is what the editor read shows beyond the car; null for ports that carry only the car and the version. */
    record AccountFacts(CurrentContract currentContract, String factsVersion, Known known) {
        public AccountFacts(CurrentContract currentContract, String factsVersion) {
            this(currentContract, factsVersion, null);
        }
    }

    /** The account read's facts and versions; a Java null field is an absent key, a JSON null is a missing value. */
    record Known(JsonNode account, JsonNode currentContract, JsonNode drivers, JsonNode accountVersions,
            String accountContextVersion, String clockVersion, JsonNode employeeFacts, String providerFactsVersion) {}

    record CurrentContract(String contractId, String model) {}
}
