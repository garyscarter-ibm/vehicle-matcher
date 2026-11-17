package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The Java demo provider against the Node provider's own outputs (tools/supply-baseline/generate.mjs). */
class DemoSupplyProviderTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");
    private static final Path GOLDEN = Path.of("src/test/resources/supply/demo-parity.json");

    private static PolicyService policy() {
        return new PolicyService(new RetainedFilePolicySource(SEED, List.of()));
    }

    private static PolicyService policyWith(java.util.function.Consumer<ObjectNode> edit) {
        return new PolicyService(new gcsp.api.policy.PolicySource() {
            @Override
            public List<JsonNode> loadVersions(String runId) throws gcsp.api.policy.PolicySourceException {
                try {
                    ObjectNode seed = (ObjectNode) JSON.readTree(Files.readAllBytes(SEED));
                    edit.accept(seed);
                    return List.of(seed);
                } catch (java.io.IOException e) {
                    throw new IllegalStateException(e);
                }
            }
        });
    }

    private static ConfirmedSupplyLookup lookup(Map<String, ConfirmedSupplyLookup.Confirmed> held) {
        return new ConfirmedSupplyLookup() {
            @Override
            public Map<String, Confirmed> find(String runId, Collection<String> supplyIds) {
                Map<String, Confirmed> out = new HashMap<>();
                for (String id : supplyIds) if (held.containsKey(id)) out.put(id, held.get(id));
                return out;
            }
        };
    }

    private static PullRequest request(JsonNode r) {
        List<PullRequest.Released> released = new ArrayList<>();
        for (JsonNode x : r.get("released")) {
            List<String> ids = new ArrayList<>();
            x.get("orderUuids").forEach(id -> ids.add(id.asText()));
            released.add(new PullRequest.Released(x.get("trancheId").asText(), ids));
        }
        List<PullRequest.QueuedSupply> queued = new ArrayList<>();
        for (JsonNode q : r.get("queuedSupply")) {
            queued.add(new PullRequest.QueuedSupply(q.get("supplyId").asText(), Instant.parse(q.get("confirmedAt").asText()),
                    Instant.parse(q.get("eligibleFrom").asText()), q.get("sourceVersion").asText(),
                    q.get("policyVersion").asText()));
        }
        return new PullRequest(r.get("runId").asText(), Instant.parse(r.get("asOf").asText()), r.get("tickId").asText(),
                r.get("releaseSize").asInt(), r.get("leadTimeDays").asInt(), r.get("policyVersion").asText(), released,
                queued);
    }

    private static Map<String, ConfirmedSupplyLookup.Confirmed> held(JsonNode c) {
        Map<String, ConfirmedSupplyLookup.Confirmed> out = new HashMap<>();
        if (c == null || c.isNull()) return out;
        c.fields().forEachRemaining(e -> out.put(e.getKey(), new ConfirmedSupplyLookup.Confirmed(
                e.getValue().get("model").asText(), e.getValue().get("derivative").asText(),
                e.getValue().get("quantity").asInt())));
        return out;
    }

    private static JsonNode value(ProviderResponse r) {
        return assertInstanceOf(ProviderResponse.Ok.class, r).value();
    }

    @Test
    void everyNodeCaseMatchesTheJavaOutputExactly() throws Exception {
        JsonNode golden = JSON.readTree(Files.readAllBytes(GOLDEN));
        assertTrue(golden.get("cases").size() >= 7);
        for (JsonNode c : golden.get("cases")) {
            DemoSupplyProvider provider = new DemoSupplyProvider(policy(), lookup(held(c.get("confirmedSupply"))));
            JsonNode actual = value(provider.pull(request(c.get("request"))));
            JsonNode expected = c.get("expected");
            // Numbers compare by value: Node writes 45 where Jackson reads either int or double.
            assertEquals(expected, normalise(actual), c.get("name").asText());
        }
    }

    private static JsonNode normalise(JsonNode n) throws Exception {
        return JSON.readTree(JSON.writeValueAsBytes(n));
    }

    @Test
    void policyWindowsOutsideTheContractAreUnavailable() {
        PullRequest req = request(first("release cue"));
        ProviderResponse noWindows = new DemoSupplyProvider(policyWith(seed -> removeKey(seed, "supply.release.windows")),
                lookup(Map.of())).pull(req);
        assertInstanceOf(ProviderResponse.Unavailable.class, noWindows);
        ProviderResponse noClock = new DemoSupplyProvider(policyWith(seed -> removeKey(seed, "clock.scenario.v1")),
                lookup(Map.of())).pull(req);
        assertInstanceOf(ProviderResponse.Unavailable.class, noClock);
        ProviderResponse unknownKind = new DemoSupplyProvider(policyWith(seed -> ((ObjectNode) windows(seed).path("windows").get(0))
                .withArray("cars").add("coupe")), lookup(Map.of())).pull(req);
        assertInstanceOf(ProviderResponse.Unavailable.class, unknownKind);
        ProviderResponse duplicate = new DemoSupplyProvider(policyWith(seed -> ((com.fasterxml.jackson.databind.node.ArrayNode)
                windows(seed).get("windows")).add(windows(seed).get("windows").get(0).deepCopy())),
                lookup(Map.of())).pull(req);
        assertInstanceOf(ProviderResponse.Unavailable.class, duplicate);
        ProviderResponse badCue = new DemoSupplyProvider(policyWith(seed -> ((ObjectNode) windows(seed)).put("cue", "nope")),
                lookup(Map.of())).pull(req);
        assertInstanceOf(ProviderResponse.Unavailable.class, badCue);
    }

    @Test
    void aFailingLookupIsUnavailableNotAnEmptyDemoPull() {
        ConfirmedSupplyLookup down = (run, ids) -> {
            throw new IllegalStateException("db down");
        };
        PullRequest req = request(first("confirmed supply releases first"));
        assertInstanceOf(ProviderResponse.Unavailable.class, new DemoSupplyProvider(policy(), down).pull(req));
    }

    @Test
    void aConfirmedSupplyOfAnUnknownModelIsIgnoredSoTheDemoWindowsRelease() {
        PullRequest req = request(first("confirmed supply releases first"));
        Map<String, ConfirmedSupplyLookup.Confirmed> unknown = Map.of("sup-confirmed-1",
                new ConfirmedSupplyLookup.Confirmed("Z4", "M40i", 2));
        JsonNode out = value(new DemoSupplyProvider(policy(), lookup(unknown)).pull(req));
        assertEquals("demo-synthetic-stock-v1:demo-release-1:0", out.at("/tranche/trancheId").asText());
        assertNull(out.at("/tranche/supplyId").textValue());
    }

    @Test
    void twoInstancesAnswerIdenticallyAndOneInstanceRepeatsItself() {
        PullRequest req = request(first("release cue"));
        JsonNode a = value(new DemoSupplyProvider(policy(), lookup(Map.of())).pull(req));
        JsonNode b = value(new DemoSupplyProvider(policy(), lookup(Map.of())).pull(req));
        assertEquals(a, b);
        DemoSupplyProvider one = new DemoSupplyProvider(policy(), lookup(Map.of()));
        assertEquals(value(one.pull(req)), value(one.pull(req)));
    }

    private static JsonNode first(String name) {
        try {
            for (JsonNode c : JSON.readTree(Files.readAllBytes(GOLDEN)).get("cases")) {
                if (name.equals(c.get("name").asText())) return c.get("request");
            }
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
        throw new IllegalStateException(name);
    }

    private static void removeKey(ObjectNode seed, String key) {
        ((com.fasterxml.jackson.databind.node.ArrayNode) seed.get("assumptions"))
                .removeIf(a -> key.equals(a.get("key").asText()));
    }

    private static JsonNode windows(ObjectNode seed) {
        for (JsonNode a : seed.get("assumptions")) {
            if ("supply.release.windows".equals(a.get("key").asText())) return a.get("value");
        }
        throw new IllegalStateException("no windows");
    }
}
