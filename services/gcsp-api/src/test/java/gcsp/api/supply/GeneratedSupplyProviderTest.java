package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** F231: expired unreleased stock cannot poison an otherwise valid generated tranche. */
class GeneratedSupplyProviderTest {
    private static final Instant NOW = Instant.parse("2026-11-06T10:00:00Z");

    @Test
    void generatedRowsUseOrderNumberWindowsAndExactSourceVersion() throws Exception {
        ArrayNode rows = rows();
        ProviderResponse.Ok result = assertInstanceOf(ProviderResponse.Ok.class,
                GeneratedSupplyProvider.pullRows(rows, request(List.of())));
        assertEquals("stock-generator.v1:gcsp-policy-v1:first:0", result.value().path("tranche").path("trancheId").asText());
        assertEquals("synthetic-stock", result.value().path("source").path("providerId").asText());
        assertEquals("stock-generator.v1:gcsp-policy-v1", result.value().path("source").path("version").asText());
        assertEquals("00000000-0000-4000-8000-000000000002", result.value().path("stock").get(0).path("orderUuid").asText());
        assertEquals("2026-11-16T00:00:00.000Z", result.value().path("stock").get(0).path("availability").path("availableUntil").asText());
        assertEquals(1, result.value().path("stock").size());
    }

    @Test
    void availabilityEqualityExpiresOnlyUnreleasedCarsAndKeepsOriginalWindowOffset() throws Exception {
        ArrayNode rows = rows();
        ((ObjectNode) rows.get(1).path("facts").path("facts").path("confirmedDeliveryWeek")).put("value", "2026-11-06");
        ProviderResponse.Ok result = assertInstanceOf(ProviderResponse.Ok.class,
                GeneratedSupplyProvider.pullRows(rows, request(List.of())));
        assertEquals("stock-generator.v1:gcsp-policy-v1:first:1", result.value().path("tranche").path("trancheId").asText());
        assertEquals(1, result.value().path("stock").size());
        assertEquals("00000000-0000-4000-8000-000000000001", result.value().path("stock").get(0).path("orderUuid").asText());
        ProviderResponse.Ok known = assertInstanceOf(ProviderResponse.Ok.class,
                GeneratedSupplyProvider.pullRows(rows, request(List.of(new PullRequest.Released("earlier", List.of(
                        "00000000-0000-4000-8000-000000000002"))))));
        assertEquals(2, known.value().path("stock").size());
    }

    @Test
    void absentOrInvalidGeneratedRowsAreUnavailable() {
        assertInstanceOf(ProviderResponse.Unavailable.class,
                GeneratedSupplyProvider.pullRows(SupplyFixture.JSON.createArrayNode(), request(List.of())));
    }

    private static PullRequest request(List<PullRequest.Released> released) {
        return new PullRequest("run-1", NOW, "tick-1", 1, 0, "gcsp-policy-v1", released, List.of());
    }

    private static ArrayNode rows() throws Exception {
        ArrayNode out = SupplyFixture.JSON.createArrayNode();
        for (int i = 1; i <= 2; i++) {
            ObjectNode row = SupplyFixture.plan().path("windows").get(0).path("stock").get(i - 1).deepCopy();
            row.put("orderNumber", i == 1 ? "0000002" : "0000001");
            ObjectNode facts = row.putObject("facts");
            facts.put("sourceNamespace", "synthetic:stock-generator.v1");
            ObjectNode values = facts.putObject("facts");
            values.putObject("generatorVersion").put("value", "stock-generator.v1");
            values.putObject("policyVersion").put("value", "gcsp-policy-v1");
            values.putObject("confirmedDeliveryWeek").put("value", "2026-11-16");
            values.putObject("plannedRelease").putObject("value").put("windowStart", "2026-11-06T09:00:00.000Z")
                    .put("releaseId", "first");
            out.add(row);
        }
        return out;
    }
}
