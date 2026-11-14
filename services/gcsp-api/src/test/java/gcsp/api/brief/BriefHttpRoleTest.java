package gcsp.api.brief;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.auth.IdentityRefusal;
import gcsp.api.identity.Principal;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/** A presenter-only principal is refused before anything else; the scope rules are checked on principals directly. */
@QuarkusTest
@TestProfile(BriefHttpProfiles.Presenter.class)
class BriefHttpRoleTest {

    @Test
    void aNonEmployeeRoleIs403() {
        given().header("Authorization", "Bearer " + BriefHttpProfiles.TOKEN).get("/api/gcsp/v1/brief/editor").then()
                .statusCode(403).contentType(containsString("application/json"))
                .body("status", equalTo("forbidden")).body("code", equalTo("role-required"));
        given().header("Authorization", "Bearer " + BriefHttpProfiles.TOKEN).contentType("application/json").body("{}")
                .post("/api/gcsp/v1/brief/engage").then().statusCode(403).body("code", equalTo("role-required"));
    }

    @Test
    void scopeComesFromThePrincipalAndNeedsAnEmployeeId() {
        Principal ok = new Principal("sub", List.of("employee"), "env", "run-1", "emp", "gcsp-policy-v1", List.of());
        assertEquals(new BriefScope("env", "run-1", "emp", "sub", "gcsp-policy-v1"), BriefResource.scope(ok));
        Principal noEmployee = new Principal("sub", List.of("employee"), "env", "run-1", null, "gcsp-policy-v1", List.of());
        IdentityRefusal refusal = Assertions.assertThrows(IdentityRefusal.class, () -> BriefResource.scope(noEmployee));
        assertEquals(403, refusal.http());
        assertEquals("not-resource-owner", refusal.code());
        Principal noPolicy = new Principal("sub", List.of("employee"), "env", "run-1", "emp", null, List.of());
        assertEquals(null, BriefResource.scope(noPolicy));
    }
}
