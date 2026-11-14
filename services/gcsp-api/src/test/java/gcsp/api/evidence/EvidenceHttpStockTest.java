package gcsp.api.evidence;

import static gcsp.api.evidence.EvidenceHttpSupport.BASE;
import static gcsp.api.evidence.EvidenceHttpSupport.employee;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Exact stock identity over HTTP: cars sharing one configuration are told apart by order UUID, within the current run. */
@QuarkusTest
@TestProfile(EvidenceHttpStockProfile.class)
class EvidenceHttpStockTest {

    static final String CONFIG = "UkVGMTpSRUZFUkVOQ0U=";
    static final String CAR_A = "7e1c0000-0000-4000-8000-0000000000a1";
    static final String CAR_B = "7e1c0000-0000-4000-8000-0000000000b2";
    static final String CAR_OLD = "7e1c0000-0000-4000-8000-0000000000c3";
    static final String CAR_SUBSTITUTED = "7e1c0000-0000-4000-8000-0000000000d4";
    static final String CAR_NO_CONFIG = "7e1c0000-0000-4000-8000-0000000000e5";
    static final String ABSENT = "7e1c0000-0000-4000-8000-0000000000f6";
    static final List<String> CARS = List.of(CAR_A, CAR_B, CAR_OLD, CAR_SUBSTITUTED, CAR_NO_CONFIG);

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @BeforeEach
    void seed() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        clean();
        JsonNode record = LookupCases.store("lookup-reference.v1").getConfiguration(CONFIG).record();
        String hash = CanonicalJson.digest(record.get("configuration"));
        String snapshot = record.get("snapshotVersion").textValue();
        update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, 'run-0', 'retired', now()) "
                + "ON CONFLICT DO NOTHING", EvidenceHttpStockProfile.ENV);
        car("run-1", CAR_A, CONFIG, "0000451", "stock-car-a", snapshot, hash);
        car("run-1", CAR_B, CONFIG, "0000452", "stock-car-b", snapshot, hash);
        car("run-0", CAR_OLD, CONFIG, "0000453", "stock-car-old", snapshot, hash);
        car("run-1", CAR_SUBSTITUTED, CONFIG, "0000454", "stock-car-sub", snapshot, "0".repeat(64));
        car("run-1", CAR_NO_CONFIG, "bm90LWluLXRoZS1jb3JwdXM=", "0000455", "stock-car-nc", snapshot, hash);
    }

    @AfterEach
    void clean() throws SQLException {
        if (!persistence.active()) return;
        for (String uuid : CARS) update("DELETE FROM stock_cars WHERE order_uuid = ?", uuid);
    }

    void car(String run, String uuid, String configurationId, String orderNumber, String vehicleId, String snapshot,
            String hash) throws SQLException {
        String attributes = "{\"orderNumber\":\"" + orderNumber + "\",\"facts\":{\"syntheticIdentity\":{\"identityKind\":"
                + "\"synthetic\",\"vehicleId\":\"" + vehicleId + "\",\"originatingDatasetId\":\"lookup-fixture\","
                + "\"snapshotVersion\":\"" + snapshot + "\",\"configurationHash\":\"" + hash + "\"}}}";
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, ?, ?, ?, 'released', ?::jsonb)", EvidenceHttpStockProfile.ENV, run, uuid, configurationId,
                attributes);
    }

    void update(String sql, String... params) throws SQLException {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setString(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    @Test
    void eachCarReturnsItsOwnIdentityWhileTheConfigurationIsShared() {
        for (String[] car : new String[][] {{CAR_A, "0000451", "stock-car-a"}, {CAR_B, "0000452", "stock-car-b"}}) {
            employee().get(BASE + "/stock/" + car[0]).then().statusCode(200).body("status", equalTo("ok"))
                    .body("value.vehicle.identity.usage", equalTo("stock"))
                    .body("value.vehicle.identity.orderUuid", equalTo(car[0]))
                    .body("value.vehicle.identity.orderNumber", equalTo(car[1]))
                    .body("value.vehicle.identity.vehicleId", equalTo(car[2]))
                    .body("value.vehicle.identity.configurationId", equalTo(CONFIG))
                    .body("value.vehicle.resolved.configurationId", equalTo(CONFIG));
        }
    }

    @Test
    void theConfigurationRouteForTheSameIdHasNoCarIdentity() {
        employee().get(BASE + "/configurations/" + CONFIG).then().statusCode(200)
                .body("value.vehicle.identity.usage", equalTo("configuration"))
                .body("value.vehicle.identity.vehicleId", nullValue())
                .body("value.vehicle.identity.orderUuid", nullValue())
                .body("value.vehicle.identity.orderNumber", nullValue());
    }

    @Test
    void anUnknownOrOtherRunCarIs404AndABrokenAssociationIsRefused() {
        employee().get(BASE + "/stock/" + ABSENT).then().statusCode(404).body("code", equalTo("vehicle-not-found"));
        employee().get(BASE + "/stock/" + CAR_OLD).then().statusCode(404).body("code", equalTo("vehicle-not-found"));
        employee().get(BASE + "/stock/" + CAR_SUBSTITUTED).then().statusCode(409)
                .body("code", equalTo("vehicle-identity-mismatch"));
        // As Node: routing cannot classify a configuration absent from the corpus, so it is unavailable, not a 409.
        employee().get(BASE + "/stock/" + CAR_NO_CONFIG).then().statusCode(503)
                .body("code", equalTo("vehicle-source-unavailable"));
    }
}
