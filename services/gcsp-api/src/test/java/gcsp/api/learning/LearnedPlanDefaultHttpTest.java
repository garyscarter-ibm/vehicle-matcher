package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/** The default composition has no model setting, so the started app's learned section is the no-active-model fallback. */
@QuarkusTest
@TestProfile(LearnedPlanProfiles.Default.class)
class LearnedPlanDefaultHttpTest extends LearnedPlanHttpBase {

    private static String ownedSchema;

    @Inject
    Persistence persistence;

    @Inject
    LearnedModelActivation activation;

    @AfterAll
    static void drop() throws Exception {
        dropSchema(ownedSchema, LearnedPlanProfiles.Default.SCHEMA_PREFIX);
    }

    @Test
    void withoutAModelSettingTheLearnedSectionFallsBackToTheBaseline() throws Exception {
        assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        assertEquals("not-configured", activation.summary());
        tick(token("sub-presenter", "presenter"));
        confirmBrief("sub-paula");
        Resp read = get(token("sub-greg", "greg"), PLAN);
        assertEquals(200, read.status(), read.toString());
        assertEquals("feasible", read.body().at("/value/plan/status").asText());
        assertEquals(LearnedPlanProfiles.BASE, read.body().at("/value/plan/versions/policy").asText());
        JsonNode learned = read.body().at("/value/learned");
        assertEquals("fallback", learned.get("status").asText(), learned.toString());
        assertEquals("no-active-model", learned.get("reason").asText());
        assertEquals("Learned model", learned.get("label").asText());
        assertFalse(learned.get("recommended").asBoolean());
        assertFalse(learned.get("submittable").asBoolean());
        assertEquals(0, count("SELECT count(*) FROM policy_versions WHERE policy_version LIKE '%learned-model%'"));
    }
}
