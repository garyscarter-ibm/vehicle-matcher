package gcsp.api.recommendation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Ranking.rank on small synthetic decisions: similar fit first, then more of the allowance (FUCQ-381). */
class RankingTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final RecommendationConfig BANDED = config("{\"ranking\":{\"rule\":\"similarFitThenPoints\",\"fitTolerance\":5}}");

    private static RecommendationConfig config(String json) {
        try {
            return new RecommendationConfig(JSON.readTree(json));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ObjectNode car(String uuid, String gate, int score, int points) {
        ObjectNode d = JSON.createObjectNode().put("orderUuid", uuid).put("gateStatus", gate).put("score", score);
        d.putObject("terms").putObject("points").put("value", points);
        return d;
    }

    private static ObjectNode eligible(String uuid, int score, int points) {
        return car(uuid, "eligible", score, points);
    }

    private static List<String> ids(List<JsonNode> ranked) {
        return ranked.stream().map(d -> d.get("orderUuid").asText()).toList();
    }

    @Test
    void equalFitCarsUsingMoreOfTheAllowanceRankHigher() {
        List<JsonNode> ranked = Ranking.rank(List.of(eligible("a-800", 100, 800), eligible("b-1100", 100, 1100)), BANDED);
        assertEquals(List.of("b-1100", "a-800"), ids(ranked));
    }

    @Test
    void aStrongMismatchStaysBelowAndScoresAreUntouched() {
        List<JsonNode> in = List.of(eligible("p100", 100, 800), eligible("p96", 96, 1200), eligible("p63", 63, 1300));
        List<JsonNode> ranked = Ranking.rank(in, BANDED);
        assertEquals(List.of("p96", "p100", "p63"), ids(ranked));
        assertEquals(List.of(96, 100, 63), ranked.stream().map(d -> d.get("score").asInt()).toList());
        assertEquals(List.of(1200, 800, 1300),
                ranked.stream().map(d -> d.get("terms").get("points").get("value").asInt()).toList());
    }

    @Test
    void bandsAreAnchoredToTheBestScoreSoNearTiesDoNotChain() {
        List<JsonNode> ranked = Ranking.rank(
                List.of(eligible("s100", 100, 800), eligible("s96", 96, 900), eligible("s92", 92, 1300)), BANDED);
        assertEquals(List.of("s96", "s100", "s92"), ids(ranked));
    }

    @Test
    void carsThatAreNotEligibleAreNeverReturnedWhateverTheirPoints() {
        List<JsonNode> ranked = Ranking.rank(List.of(car("nc", "needs-confirmation", 100, 1300), car("in", "ineligible", 100, 1300),
                eligible("ok", 90, 100)), BANDED);
        assertEquals(List.of("ok"), ids(ranked));
    }

    @Test
    void withoutARankingPolicyTheOrderIsScoreThenUuid() {
        RecommendationConfig plain = config("{}");
        List<JsonNode> ranked = Ranking.rank(
                List.of(eligible("b", 100, 1300), eligible("a", 100, 800), eligible("c", 101, 100)), plain);
        assertEquals(List.of("c", "a", "b"), ids(ranked));
    }

    @Test
    void anInvalidRuleOrToleranceFailsClosed() {
        List<JsonNode> in = List.of(eligible("a", 100, 800));
        for (String bad : List.of("{\"ranking\":{\"rule\":\"pointsOnly\",\"fitTolerance\":5}}",
                "{\"ranking\":{\"rule\":\"similarFitThenPoints\",\"fitTolerance\":-1}}",
                "{\"ranking\":{\"rule\":\"similarFitThenPoints\",\"fitTolerance\":101}}",
                "{\"ranking\":{\"rule\":\"similarFitThenPoints\",\"fitTolerance\":\"5\"}}",
                "{\"ranking\":{\"rule\":\"similarFitThenPoints\"}}")) {
            assertThrows(RecommendationFault.class, () -> Ranking.rank(in, config(bad)), bad);
        }
    }
}
