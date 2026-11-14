package gcsp.api.recommendation;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The route's role, run and configuration refusals; each nested class is one Quarkus profile. */
class RecommendationRefusalHttpTest {

    private static final String BODY = RecommendationHttpTest.BRIEF;

    private static io.restassured.specification.RequestSpecification as() {
        return given().header("Authorization", "Bearer " + RecommendationHttpProfiles.TOKEN).contentType(ContentType.JSON);
    }

    @QuarkusTest
    @TestProfile(RecommendationHttpProfiles.Greg.class)
    static class GregRole {
        @Test
        void aGregPrincipalIs403() {
            as().body(BODY).post(RecommendationHttpTest.PATH).then().statusCode(403)
                    .contentType(containsString("application/json")).body("status", equalTo("forbidden"))
                    .body("code", equalTo("role-required"));
        }
    }

    @QuarkusTest
    @TestProfile(RecommendationHttpProfiles.NoDatabase.class)
    static class Unconfigured {
        @Test
        void withoutPersistenceTheRouteIs503WithAStableCode() {
            as().body(BODY).post(RecommendationHttpTest.PATH).then().statusCode(503)
                    .contentType(containsString("application/json")).body("status", equalTo("unavailable"))
                    .body("code", equalTo("persistence-not-configured"));
        }
    }

    @QuarkusTest
    @TestProfile(RecommendationHttpProfiles.NoAccountProvider.class)
    static class NoAccount {
        @Inject
        Persistence persistence;

        @BeforeEach
        void needsDatabase() {
            Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        }

        @Test
        void withoutAnAccountProviderTheRouteIs503WithAStableCode() {
            as().body(BODY).post(RecommendationHttpTest.PATH).then().statusCode(503)
                    .contentType(containsString("application/json")).body("code", equalTo("account-provider-not-configured"));
        }
    }

    @QuarkusTest
    @TestProfile(RecommendationHttpProfiles.StaleRun.class)
    static class StaleRun {
        @Inject
        Persistence persistence;

        @BeforeEach
        void needsDatabase() {
            Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        }

        @Test
        void aPrincipalOnARetiredRunIs409() {
            as().body(BODY).post(RecommendationHttpTest.PATH).then().statusCode(409).contentType(containsString("application/json"))
                    .body("status", equalTo("stale-run"));
        }
    }
}
