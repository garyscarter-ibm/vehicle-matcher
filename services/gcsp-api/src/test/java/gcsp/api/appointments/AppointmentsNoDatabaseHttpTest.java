package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** With persistence off every appointment call is 503 persistence-not-configured; needs no database. */
@QuarkusTest
@TestProfile(ApptHttpProfiles.NoDatabase.class)
class AppointmentsNoDatabaseHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AppointmentsStartup startup;

    @Test
    void withoutPersistenceEveryCallAnswers503() throws Exception {
        ApptHttp http = new ApptHttp(signingJwk);
        http.as("paula").get(BASE + "/appointments?orderUuid=o-1").then().statusCode(503)
                .body("code", equalTo("persistence-not-configured")).body("retryable", equalTo(false));
        http.as("greg").body("{\"commandId\":\"c\",\"orderUuid\":\"o-1\",\"expectedVersion\":1}")
                .post(BASE + "/appointments/complete").then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        http.as("presenter").body("{\"tickId\":\"t\",\"now\":\"2026-11-05T09:00:00Z\"}")
                .post(BASE + "/presenter/appointments/ticks").then().statusCode(503)
                .body("code", equalTo("persistence-not-configured"));
        http.as("alex").get(BASE + "/appointments?orderUuid=o-1&x=1").then().statusCode(400);
        assertEquals("skipped", startup.summary());
    }
}
