package gcsp.api.recommendation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import java.io.IOException;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The source adapter over in-memory ports against the Node provider output (source-cases.json) and its failure outcomes. */
class ReleasedStockSourceTest {

    private static final VehicleEvidencePort FACTS = new StockFactsEvidence();

    static String text(JsonNode n) {
        return Canonical.json(n);
    }

    @Test
    void sourceMatchesTheNodeRuntimeProviderForEveryCase() throws IOException {
        JsonNode file = RecommendationDb.resource("/recommendation-source/source-cases.json");
        assertEquals(4, file.get("cases").size());
        for (JsonNode c : file.get("cases")) {
            SourceFixture.Pager pager = new SourceFixture.Pager(SourceFixture.cars(c.get("rows")));
            ReleasedStockRecommendationSource source = SourceFixture.source(c.get("employee").asText(), pager, FACTS);
            JsonNode actual = source.resolve(SourceFixture.context(c.get("employee").asText()));
            assertEquals(text(c.get("expected")), text(actual), c.get("name").asText());
        }
    }

    @Test
    void visibilityAndOccupancyShapeTheCandidates() throws IOException {
        JsonNode c = RecommendationDb.resource("/recommendation-source/source-cases.json").get("cases").get(0);
        SourceFixture.Pager pager = new SourceFixture.Pager(SourceFixture.cars(c.get("rows")));
        JsonNode value = SourceFixture.source("paula", pager, FACTS).resolve(SourceFixture.context("paula")).get("value");
        List<String> ids = value.get("stock").findValuesAsText("orderUuid");
        assertEquals(4, ids.size());
        assertTrue(ids.stream().noneMatch(id -> id.endsWith("4") || id.endsWith("5")), "hidden cars are absent: " + ids);
        assertEquals("unavailable", value.get("stock").get(2).get("availability").get("state").asText());
        assertEquals("available", value.get("stock").get(0).get("availability").get("state").asText());
        assertTrue(value.get("stockVersion").asText().contains("0006:4"), "version counts every released row");
    }

    @Test
    void anUnconfirmedVisibilityRecordMakesTheWholeSourceUnavailable() throws IOException {
        JsonNode c = RecommendationDb.resource("/recommendation-source/source-cases.json").get("cases").get(0);
        ArrayNode rows = (ArrayNode) c.get("rows").deepCopy();
        ((ObjectNode) rows.get(1)).remove("visibility");
        SourceFixture.Pager pager = new SourceFixture.Pager(SourceFixture.cars(rows));
        JsonNode out = SourceFixture.source("paula", pager, FACTS).resolve(SourceFixture.context("paula"));
        assertEquals("unavailable", out.get("status").asText());
        assertTrue(out.get("retryable").asBoolean());
    }

    @Test
    void aMissingSnapshotOrAFailingPageIsUnavailableNeverInvented() throws IOException {
        JsonNode c = RecommendationDb.resource("/recommendation-source/source-cases.json").get("cases").get(0);
        SourceFixture.Pager pager = new SourceFixture.Pager(SourceFixture.cars(c.get("rows")));
        VehicleEvidencePort none = (scope, uuid, configuration, facts) -> Optional.empty();
        assertEquals("unavailable", SourceFixture.source("paula", pager, none).resolve(SourceFixture.context("paula"))
                .get("status").asText());
        StockPages failing = (scope, after, limit) -> {
            throw new SQLException("down");
        };
        assertEquals("unavailable", SourceFixture.source("paula", failing, FACTS).resolve(SourceFixture.context("paula"))
                .get("status").asText());
    }

    @Test
    void aForeignRoleIsForbiddenAndTheClockOutcomePassesThrough() throws IOException {
        SourceFixture.Pager pager = new SourceFixture.Pager(List.of());
        RecommendationContext paula = SourceFixture.context("paula");
        RecommendationContext greg = new RecommendationContext(paula.runId(), paula.environmentId(), paula.employeeId(),
                paula.companyId(), paula.schemeId(), paula.gradeId(), paula.policyVersion(), List.of("greg"), null);
        assertEquals("forbidden", SourceFixture.source("paula", pager, FACTS).resolve(greg).get("status").asText());
        JsonNode stale = Outcomes.refused();
        gcsp.api.account.AccountRecordsPort records = SourceFixture.records("paula");
        ReleasedStockRecommendationSource source = new ReleasedStockRecommendationSource(
                SourceFixture.accounts(records, SourceFixture.policy()), records, pager, FACTS, context -> stale);
        assertEquals("stale-run", source.resolve(paula).get("status").asText());
        assertEquals(0, pager.pages, "nothing is read once the clock refuses the run");
    }

    @Test
    void twelveHundredAndOneCarsAreReadInThreePagesAndAllBecomeCandidates() throws IOException {
        JsonNode template = RecommendationDb.resource("/recommendation-source/source-cases.json").get("cases").get(0).get("rows").get(0);
        ArrayNode rows = RecommendationDb.JSON.createArrayNode();
        for (int i = 1; i <= 1201; i++) {
            String uuid = String.format("00000000-0000-4000-8000-%012d", i);
            ObjectNode row = (ObjectNode) template.deepCopy();
            row.put("orderUuid", uuid);
            ((ObjectNode) row.get("facts")).put("snapshotVersion", "snapshot-v1");
            ((ObjectNode) row.get("facts").get("sourceKeys")).put("stockId", uuid);
            rows.add(row);
        }
        SourceFixture.Pager pager = new SourceFixture.Pager(SourceFixture.cars(rows));
        ReleasedStockRecommendationSource source = SourceFixture.source("paula", pager, FACTS);
        assertEquals(1201, source.resolve(SourceFixture.context("paula")).get("value").get("stock").size());
        assertEquals(3, pager.pages);
        assertEquals(List.of(500, 500, 500), pager.limits);

        pager.pages = 0;
        RecommendationService service = new RecommendationService(source, SourceFixture.policy(), SourceFixture.clock());
        JsonNode brief = RecommendationDb.JSON.readTree("{\"schemaVersion\":1,\"briefVersion\":1,\"preferences\":{},\"essentials\":{}}");
        JsonNode out = service.recommend(SourceFixture.context("paula"), brief);
        assertEquals("ok", out.get("status").asText());
        assertEquals(1201, out.get("value").get("decisions").size());
        assertEquals(3, pager.pages, "one request reads ceil(N / 500) pages");
    }

    @Test
    void anExactMultipleStillEndsWithAnEmptyFinalPage() throws IOException {
        JsonNode template = RecommendationDb.resource("/recommendation-source/source-cases.json").get("cases").get(0).get("rows").get(0);
        ArrayNode rows = RecommendationDb.JSON.createArrayNode();
        for (int i = 1; i <= 500; i++) {
            ObjectNode row = (ObjectNode) template.deepCopy();
            String uuid = String.format("00000000-0000-4000-8000-%012d", i);
            row.put("orderUuid", uuid);
            ((ObjectNode) row.get("facts").get("sourceKeys")).put("stockId", uuid);
            rows.add(row);
        }
        SourceFixture.Pager pager = new SourceFixture.Pager(SourceFixture.cars(rows));
        JsonNode value = SourceFixture.source("paula", pager, FACTS).resolve(SourceFixture.context("paula")).get("value");
        assertEquals(500, value.get("stock").size());
        assertEquals(2, pager.pages);
    }
}
