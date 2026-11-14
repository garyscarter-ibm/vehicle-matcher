package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static gcsp.api.appointments.ApptHttp.body;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.Instant;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** A live provider is an explicit stub: reads show it blocked and a request is refused with 422, booking nothing. */
@QuarkusTest
@TestProfile(ApptHttpProfiles.Live.class)
class AppointmentsLiveHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Test
    void aLiveProviderShowsBlockedAndRefusesARequestWithoutBooking() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ApptHttp http = new ApptHttp(signingJwk);
        String order = ApptHttp.id();
        ApptHttpPorts.STAGES.order(order, "employee-paula", 4);
        Instant at = ApptHttp.nextTick(dataSource.get(), persistence);
        http.as("presenter").body("{\"tickId\":\"t-" + ApptHttp.id() + "\",\"now\":\"" + at + "\"}")
                .post(BASE + "/presenter/appointments/ticks").then().statusCode(200);
        Response read = http.as("paula").get(BASE + "/appointments?orderUuid=" + order);
        assertEquals(200, read.statusCode(), read.asString());
        JsonNode v = body(read).get("value");
        assertEquals("live-appointments-unsupported", v.get("blocked").get("code").asText());
        assertEquals(0, v.get("offeredSlots").size());
        assertFalse(v.get("fictional").asBoolean());
        http.as("paula").body("{\"commandId\":\"c-" + ApptHttp.id() + "\",\"orderUuid\":\"" + order
                + "\",\"slotId\":\"slot-20261201T0900Z\",\"expectedVersion\":0}").post(BASE + "/appointments/request")
                .then().statusCode(422).body("status", equalTo("unsupported"))
                .body("code", equalTo("live-appointments-unsupported")).body("retryable", equalTo(false));
        assertEquals(0, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM appointments WHERE order_uuid = ?", order));
    }
}
