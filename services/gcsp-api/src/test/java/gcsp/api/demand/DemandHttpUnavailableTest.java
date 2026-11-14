package gcsp.api.demand;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

import gcsp.api.auth.Access;
import gcsp.api.auth.IdentityRefusal;
import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/** Persistence switched off, plus the role gate and scope rules checked on principals directly. */
@QuarkusTest
@TestProfile(DemandHttpProfiles.NoDatabase.class)
class DemandHttpUnavailableTest {

    private static String auth() {
        return "Bearer " + DemandHttpProfiles.TOKEN;
    }

    @Test
    void bothReadsAre503PersistenceNotConfigured() {
        for (String path : new String[] {"/api/gcsp/v1/greg/demand", "/api/gcsp/v1/presenter/suitability"}) {
            given().header("Authorization", auth()).get(path).then().statusCode(503).contentType(containsString("application/json"))
                    .header("Cache-Control", equalTo("no-store")).body("status", equalTo("unavailable"))
                    .body("code", equalTo("persistence-not-configured"));
        }
    }

    @Test
    void anEmployeeIsRefusedOnBothBeforeAnythingElse() {
        Principal employee = new Principal("sub", List.of("employee"), "env", "run-1", "emp", "gcsp-policy-v1", List.of());
        for (Role needed : new Role[] {Role.GREG, Role.PRESENTER}) {
            IdentityRefusal refusal = Assertions.assertThrows(IdentityRefusal.class,
                    () -> Access.requireAnyRole(employee, needed));
            Assertions.assertEquals(403, refusal.http());
            Assertions.assertEquals("role-required", refusal.code());
        }
    }

    @Test
    void scopeComesFromThePrincipalAndNeedsAnEnvironmentRunAndPolicy() {
        Principal ok = new Principal("sub", List.of("greg"), "env", "run-1", null, "gcsp-policy-v1", List.of());
        Assertions.assertEquals(new DemandScope("env", "run-1", "gcsp-policy-v1"), GregDemandResource.scope(ok));
        for (Principal p : new Principal[] {
            new Principal("sub", List.of("greg"), " ", "run-1", null, "gcsp-policy-v1", List.of()),
            new Principal("sub", List.of("greg"), "env", null, null, "gcsp-policy-v1", List.of()),
            new Principal("sub", List.of("greg"), "env", "run-1", null, "", List.of())}) {
            Assertions.assertNull(GregDemandResource.scope(p));
        }
    }

    @Test
    void anIncompleteContextIs503DemandUnavailable() {
        var response = GregDemandResource.respond(DemandResult.Refusal.unavailable("demand-unavailable"));
        Assertions.assertEquals(503, response.getStatus());
        Assertions.assertEquals("no-store", response.getHeaderString("Cache-Control"));
    }
}
