package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

class PullValidatorTest {

    static final Instant T0 = Instant.parse("2026-11-05T09:00:00Z");

    ObjectNode target() throws Exception {
        ObjectNode v = (ObjectNode) SupplyFixture.resource("real-shaped-pull.json").get("value").deepCopy();
        v.put("runId", "run-1");
        return v;
    }

    PullValidator.Result check(Consumer<ObjectNode> edit) throws Exception {
        ObjectNode v = target();
        edit.accept(v);
        return PullValidator.validate(v, "run-1", T0);
    }

    @Test
    void theTargetShapedFixtureIsValid() throws Exception {
        PullValidator.Valid ok = assertInstanceOf(PullValidator.Valid.class, check(v -> {}));
        assertEquals(1, ok.snapshot().stock().size());
        assertEquals(1, ok.snapshot().tranche().orderUuids().size());
    }

    @Test
    void envelopeAndSourceRefusals() throws Exception {
        List<Consumer<ObjectNode>> bad = List.of(
                v -> v.put("schemaVersion", "2.0.0"),
                v -> v.put("runId", "other"),
                v -> v.put("observedAt", "2026-11-05T08:59:00.000Z"),
                v -> v.put("extra", 1),
                v -> ((ObjectNode) v.get("source")).put("mode", "live"),
                v -> ((ObjectNode) v.get("source")).remove("label"),
                v -> ((ObjectNode) v.get("source")).put("other", "x"),
                v -> v.remove("tranche"));
        for (int i = 0; i < bad.size(); i++) {
            assertInstanceOf(PullValidator.Invalid.class, check(bad.get(i)), "case " + i);
        }
    }

    @Test
    void carRefusals() throws Exception {
        List<Consumer<ObjectNode>> bad = List.of(
                v -> ((ObjectNode) v.get("stock").get(0)).put("unknownField", 1),
                v -> ((ObjectNode) v.get("stock").get(0)).put("orderUuid", "00000000-0000-1000-8000-000000000001"),
                v -> ((ObjectNode) v.get("stock").get(0)).put("orderNumber", "12"),
                v -> ((ObjectNode) v.get("stock").get(0)).put("configurationId", ""),
                v -> ((ObjectNode) v.get("stock").get(0)).put("configurationId", "x".repeat(4097)),
                v -> ((ObjectNode) v.get("stock").get(0)).put("wholesalerOrderId", 123),
                v -> ((ObjectNode) v.get("stock").get(0)).put("revision", 0),
                v -> ((ObjectNode) v.get("stock").get(0)).putObject("availability").put("availableUntil", "soon"),
                v -> ((ObjectNode) v.get("stock").get(0)).putObject("availability").put("availableUntil",
                        "2026-11-09T09:00:00.000Z").put("extra", 1),
                v -> ((ObjectNode) v.get("stock").get(0)).putObject("facts").put("VIN7", "x"));
        for (int i = 0; i < bad.size(); i++) {
            assertInstanceOf(PullValidator.Invalid.class, check(bad.get(i)), "case " + i);
        }
    }

    @Test
    void duplicateOrderNumberAndTrancheRefusals() throws Exception {
        assertInstanceOf(PullValidator.Invalid.class, check(v -> {
            ObjectNode second = v.get("stock").get(0).deepCopy();
            second.put("orderUuid", "00000000-0000-4000-8000-000000000002");
            ((com.fasterxml.jackson.databind.node.ArrayNode) v.get("stock")).add(second);
        }));
        List<Consumer<ObjectNode>> bad = List.of(
                v -> ((ObjectNode) v.get("tranche")).put("availableAt", "2026-11-05T09:00:01.000Z"),
                v -> ((ObjectNode) v.get("tranche")).putArray("orderUuids"),
                v -> ((ObjectNode) v.get("tranche")).putArray("orderUuids").add("00000000-0000-4000-8000-000000000009"),
                v -> ((ObjectNode) v.get("tranche")).put("extra", 1),
                v -> ((ObjectNode) v.get("tranche")).remove("supplyId"));
        for (int i = 0; i < bad.size(); i++) {
            assertInstanceOf(PullValidator.Invalid.class, check(bad.get(i)), "tranche case " + i);
        }
    }

    @Test
    void stalenessUsesOnlyAValidEarlierObservation() throws Exception {
        ObjectNode v = target();
        v.put("observedAt", "2026-11-05T07:59:00.000Z");
        assertTrue(PullValidator.isStale(v, T0, 60));
        v.put("observedAt", "2026-11-05T08:00:00.000Z");
        assertFalse(PullValidator.isStale(v, T0, 60));
        v.put("observedAt", "2026-11-05T09:00:00.000Z");
        assertFalse(PullValidator.isStale(v, T0, 60));
        v.put("observedAt", "garbage");
        assertFalse(PullValidator.isStale(v, T0, 60));
    }

    @Test
    void tranchePlanRefusesBadPlansAtConstruction() throws Exception {
        JsonNode good = SupplyFixture.plan();
        new TranchePlanProvider(good);
        List<Consumer<ObjectNode>> bad = List.of(
                p -> p.remove("label"),
                p -> p.remove("version"),
                p -> ((ObjectNode) p.get("windows").get(0)).put("availableAt", "later"),
                p -> ((ObjectNode) p.get("windows").get(0)).remove("supplyId"),
                p -> ((com.fasterxml.jackson.databind.node.ArrayNode) p.get("windows")).add(p.get("windows").get(0).deepCopy()),
                p -> ((ObjectNode) p.get("windows").get(0).get("stock").get(1)).put("orderUuid",
                        p.get("windows").get(0).get("stock").get(0).get("orderUuid").asText()),
                p -> ((ObjectNode) p.get("windows").get(0).get("stock").get(0)).put("orderNumber", "x"));
        for (int i = 0; i < bad.size(); i++) {
            ObjectNode copy = good.deepCopy();
            bad.get(i).accept(copy);
            assertThrows(IllegalArgumentException.class, () -> new TranchePlanProvider(copy), "case " + i);
        }
    }

    @Test
    void tranchePlanPullFollowsTheNodeProvider() throws Exception {
        TranchePlanProvider p = new TranchePlanProvider(SupplyFixture.plan());
        assertEquals("tranche-plan", p.mode());
        ProviderResponse.Ok early = (ProviderResponse.Ok) p.pull(new PullRequest("run-1", T0.minusSeconds(1), "t", 2, 1,
                "pv", List.of(), List.of()));
        assertTrue(early.value().get("tranche").isNull());
        assertEquals(0, early.value().get("stock").size());
        ProviderResponse.Ok first = (ProviderResponse.Ok) p.pull(new PullRequest("run-1", T0, "t", 2, 1, "pv",
                List.of(), List.of()));
        assertEquals("fucq92-small-test-v1:test-weekly-window:0", first.value().get("tranche").get("trancheId").asText());
        assertEquals(2, first.value().get("stock").size());
        assertEquals("run-1", first.value().get("runId").asText());
        assertEquals("2026-11-05T09:00:00.000Z", first.value().get("observedAt").asText());
        ProviderResponse.Ok second = (ProviderResponse.Ok) p.pull(new PullRequest("run-1", T0, "t", 2, 1, "pv",
                List.of(new PullRequest.Released("x", List.of("00000000-0000-4000-8000-000000000001",
                        "00000000-0000-4000-8000-000000000002"))), List.of()));
        assertEquals("fucq92-small-test-v1:test-weekly-window:2", second.value().get("tranche").get("trancheId").asText());
        assertEquals(4, second.value().get("stock").size());
        assertInstanceOf(ProviderResponse.Unavailable.class,
                new UnconfiguredProvider().pull(new PullRequest("r", T0, "t", 1, 0, "pv", List.of(), List.of())));
        assertEquals("none", new UnconfiguredProvider().mode());
    }
}
