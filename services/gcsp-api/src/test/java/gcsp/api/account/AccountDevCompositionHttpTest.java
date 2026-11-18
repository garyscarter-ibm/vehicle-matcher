package gcsp.api.account;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.nio.file.Path;
import java.sql.Connection;
import org.junit.jupiter.api.AfterAll;

/** Started app on provider repository; the comparison reads the same people through an hr-snapshot export. */
@QuarkusTest
@TestProfile(AccountDevCompositionProfiles.Repository.class)
class AccountDevCompositionHttpTest extends AccountDevCompositionBase {

    private static final Path COMPARE = export("compare-hr-export.json");

    @Override
    AccountRecordsPort otherShape() throws Exception {
        try (Connection c = dataSource.get().getConnection()) {
            AccountDevCompositionSupport.writeExport(COMPARE, AccountDevCompositionSupport.slotsFromDatabase(c));
        }
        return HrSnapshotRecords.open(COMPARE.toString());
    }

    @AfterAll
    static void dropSchema() throws Exception {
        AccountDevCompositionSupport.dropSchema(ownedSchema);
    }
}
