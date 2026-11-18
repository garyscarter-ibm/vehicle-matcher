package gcsp.api.health;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.junit.jupiter.api.Test;

/** A required provider that is none/unset or persistence being off makes readiness DOWN; empty list stays UP. */
@QuarkusTest
@TestProfile(RequiredProvidersReadinessTest.RequireAccountAndSupply.class)
class RequiredProvidersReadinessTest {

    public static class RequireAccountAndSupply implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("gcsp.readiness.required-providers", "account,supply");
        }
    }

    private static final Function<String, String> ALL_SET = name -> "synthetic";

    private static HealthCheckResponse eval(Function<String, String> lookup, boolean persistence, String list) {
        return RequiredProvidersReadiness.evaluate(lookup, persistence, RequiredProvidersReadiness.parse(list));
    }

    @Test
    void emptyListIsUp() {
        HealthCheckResponse r = eval(name -> null, false, "");
        assertEquals(HealthCheckResponse.Status.UP, r.getStatus());
        assertEquals("", r.getData().get().get("required"));
    }

    @Test
    void allConfiguredIsUp() {
        HealthCheckResponse r = eval(ALL_SET, true, "identity, persistence account allocation-candidates");
        assertEquals(HealthCheckResponse.Status.UP, r.getStatus());
        assertEquals("identity,persistence,account,allocation-candidates", r.getData().get().get("required"));
        assertEquals(false, r.getData().get().containsKey("unconfigured"));
    }

    @Test
    void noneIsDownAndListed() {
        Function<String, String> lookup = name -> name.equals("gcsp.supply.provider") ? "NONE " : "synthetic";
        HealthCheckResponse r = eval(lookup, true, "account,supply");
        assertEquals(HealthCheckResponse.Status.DOWN, r.getStatus());
        assertEquals("supply", r.getData().get().get("unconfigured"));
    }

    @Test
    void blankAndMissingCountAsUnconfigured() {
        Function<String, String> lookup = name -> name.equals("gcsp.account.provider") ? "  " : null;
        HealthCheckResponse r = eval(lookup, true, "account,ordering");
        assertEquals(HealthCheckResponse.Status.DOWN, r.getStatus());
        assertEquals("account,ordering", r.getData().get().get("unconfigured"));
    }

    @Test
    void persistenceOffIsDown() {
        HealthCheckResponse r = eval(ALL_SET, false, "account,persistence");
        assertEquals(HealthCheckResponse.Status.DOWN, r.getStatus());
        assertEquals("persistence", r.getData().get().get("unconfigured"));
    }

    @Test
    void unknownKeyThrowsNamingKeyAndSupported() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> RequiredProvidersReadiness.validate(RequiredProvidersReadiness.parse("account,bogus")));
        assertEquals(true, e.getMessage().contains("bogus") && e.getMessage().contains("allocation-candidates"));
        assertThrows(IllegalStateException.class, () -> eval(ALL_SET, true, "bogus"));
    }

    @Test
    void parseNormalisesAndDeduplicates() {
        assertEquals(List.of("account", "supply"), RequiredProvidersReadiness.parse(" Account,,supply  ACCOUNT"));
    }

    @Test
    void readinessIsDownWhileRequiredProvidersAreNone() {
        given().when().get("/q/health/ready").then()
                .statusCode(503)
                .body("status", equalTo("DOWN"))
                .body("checks.find { it.name == 'required-providers' }.data.unconfigured", equalTo("account,supply"));
    }
}
