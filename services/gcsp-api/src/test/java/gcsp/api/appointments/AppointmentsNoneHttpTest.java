package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** The default provider (none) never silently falls back to synthetic: every call is 503 not configured. */
@QuarkusTest
@TestProfile(ApptHttpProfiles.None.class)
class AppointmentsNoneHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    AppointmentsStartup startup;

    @Test
    void noProviderAnswers503NotConfiguredAndStartupSkipsReconcile() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ApptHttp http = new ApptHttp(signingJwk);
        String order = ApptHttp.id();
        http.as("paula").get(BASE + "/appointments?orderUuid=" + order).then().statusCode(503)
                .body("code", equalTo("appointments-provider-not-configured")).body("status", equalTo("unavailable"));
        http.as("paula").body("{\"commandId\":\"c\",\"orderUuid\":\"" + order + "\",\"slotId\":\"s\",\"expectedVersion\":0}")
                .post(BASE + "/appointments/request").then().statusCode(503)
                .body("code", equalTo("appointments-provider-not-configured"));
        http.as("presenter").body("{\"tickId\":\"t\",\"now\":\"2026-11-05T09:00:00Z\"}")
                .post(BASE + "/presenter/appointments/ticks").then().statusCode(503)
                .body("code", equalTo("appointments-provider-not-configured"));
        assertEquals("skipped", startup.summary());
    }
}
