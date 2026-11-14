package gcsp.api.returns;

import static gcsp.api.returns.ReturnHttpSupport.PLAN;
import static gcsp.api.returns.ReturnHttpSupport.REQUEST;
import static gcsp.api.returns.ReturnHttpSupport.as;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.Instant;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** The live-stub provider refuses every write, so a request is an unsupported 422 that carries the plan. */
@QuarkusTest
@TestProfile(ReturnHttpProfiles.LiveStub.class)
class ReturnHttpLiveStubTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ReturnHttpPorts.Source source;

    @Inject
    ReturnHttpPorts.Handover handover;

    @Test
    void aRequestIsUnsupportedAndCarriesThePlan() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        String alice = ReturnHttpSupport.token(jwk, "sub-employee-a", "employee");
        Instant now = ReturnHttpSupport.tick(dataSource.get(), persistence, 60);
        String order = ReturnHttpSupport.orderId();
        source.put(InMemoryReturnSource.replacement(order, ReturnHttpSupport.EMPLOYEE_A));
        handover.put(order, new HandoverReading.Found("scheduled", ReturnHttpSupport.handoverSlot(now), "SYN-APT-HANDOVER"));
        JsonPath plan = new JsonPath(as(alice).queryParam("orderUuid", order).get(PLAN).then().statusCode(200).extract().asString());
        String slot = plan.getString("value.offeredSlots.'same-visit'[0].slotId");
        String body = "{\"commandId\":\"c-" + order + "\",\"orderUuid\":\"" + order + "\",\"choice\":\"same-visit\","
                + "\"slotId\":\"" + slot + "\",\"expectedVersion\":0}";
        as(alice).body(body).post(REQUEST).then().statusCode(422).contentType(containsString("application/json"))
                .body("status", equalTo("unsupported")).body("code", equalTo(LiveReturnProviderStub.APPOINTMENTS_CODE))
                .body("retryable", equalTo(false)).body("plan.orderUuid", equalTo(order)).body("plan", notNullValue());
    }
}
