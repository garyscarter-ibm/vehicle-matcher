package gcsp.api.demand;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The demand policy port over the canonical PolicyService: the retained seed, and the seed plus reviewed reasons. */
class PolicyDemandAdapterTest {

    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");
    private static final Path REASONS = Path.of("../../server/gcsp/policy/reviewed/offer-decline-reasons-v1.json");
    private static final Instant AS_OF = Instant.parse("2026-11-05T09:00:00Z");
    private static final ObjectMapper JSON = new ObjectMapper();

    private static PolicyDemandAdapter adapter(PolicyService service, String run) {
        return new PolicyDemandAdapter(service, Optional.of(run));
    }

    @Test
    void theRetainedSeedSuppliesThresholdExclusionEssentialsAndRuleButNoDeclineReasons() {
        PolicyService seed = new PolicyService(new RetainedFilePolicySource(SEED, List.of()));
        DemandPolicyPort.DemandPolicy p = adapter(seed, "run-1").read("gcsp-policy-v1", AS_OF).orElseThrow();
        assertEquals(5, p.threshold().asInt());
        assertEquals("assumed", p.thresholdStatus());
        assertEquals("untilRelevantConfirmedBriefChange", p.declinedCarExclusion().asText());
        assertTrue(p.recommendationEssentials().has("modelLine"));
        assertEquals("renewalDueThenFitThenSeededLottery", p.allocationRule().asText());
        // Reasons are a reviewed definition published separately; until then demand fails closed.
        assertNull(p.declineReasons());
    }

    @Test
    void anUnknownVersionABlankRunOrABlankVersionIsEmpty() {
        PolicyService seed = new PolicyService(new RetainedFilePolicySource(SEED, List.of()));
        assertNull(adapter(seed, "run-1").read("no-such-version", AS_OF).map(DemandPolicyPort.DemandPolicy::threshold).orElse(null));
        assertTrue(adapter(seed, "").read("gcsp-policy-v1", AS_OF).isEmpty());
        assertTrue(adapter(seed, "run-1").read(" ", AS_OF).isEmpty());
    }

    @Test
    void aSourceWithTheReviewedReasonsGivesAUsableDemandPolicy() throws Exception {
        ObjectNode seed = (ObjectNode) JSON.readTree(Files.readString(SEED));
        JsonNode reviewed = JSON.readTree(Files.readString(REASONS)).get("definitions").get(0);
        ObjectNode row = ((ObjectNode) seed.get("assumptions").get(0)).deepCopy();
        row.put("key", reviewed.get("key").asText());
        row.set("value", reviewed.get("value"));
        ((ArrayNode) seed.get("assumptions")).add(row);
        Path file = Files.createTempFile("demand-policy", ".json");
        try {
            Files.writeString(file, JSON.writeValueAsString(seed));
            PolicyService service = new PolicyService(new RetainedFilePolicySource(file, List.of()));
            DemandPolicyPort.DemandPolicy p = adapter(service, "run-1").read("gcsp-policy-v1", AS_OF).orElseThrow();
            assertEquals("body-style", p.declineReasons().get("reasons").get(0).get("code").asText());
            assertEquals(1, p.declineReasons().get("schemaVersion").asInt());
        } finally {
            Files.deleteIfExists(file);
        }
    }
}
