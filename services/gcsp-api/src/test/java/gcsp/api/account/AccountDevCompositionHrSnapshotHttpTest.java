package gcsp.api.account;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.nio.file.Files;
import java.sql.Connection;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Started app on provider hr-snapshot (persistence and demo seeding on); the comparison reads the database rows. */
@QuarkusTest
@TestProfile(AccountDevCompositionProfiles.Snapshot.class)
class AccountDevCompositionHrSnapshotHttpTest extends AccountDevCompositionBase {

    /** The started app serves the export with the timestamps the database stamped, so the shapes line up. */
    private void publishExport() throws Exception {
        try (Connection c = dataSource.get().getConnection()) {
            AccountDevCompositionSupport.writeExport(AccountDevCompositionProfiles.APP_EXPORT,
                    AccountDevCompositionSupport.slotsFromDatabase(c));
        }
    }

    @Override
    AccountRecordsPort otherShape() throws Exception {
        publishExport();
        return new RepositoryAccountRecords(dataSource.get());
    }

    @BeforeEach
    void publish() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        publishExport();
    }

    @Test
    void aMissingExportIsAnExplicitSourceFailure() throws Exception {
        String token = AccountDevCompositionSupport.token(signingJwk, "sub-paula", "employee");
        Files.delete(AccountDevCompositionProfiles.APP_EXPORT);
        try {
            given().header("Authorization", "Bearer " + token).when().get(PATH).then().statusCode(503)
                    .body("status", equalTo("unavailable")).body("code", equalTo("manual-source-unavailable"))
                    .body("retryable", equalTo(true)).body("source", equalTo("employee-contract"))
                    .body(not(containsString("hr-export"))).body(not(containsString("account-dev")));
        } finally {
            publishExport();
        }
    }

    @AfterAll
    static void dropSchema() throws Exception {
        AccountDevCompositionSupport.dropSchema(ownedSchema);
    }
}
