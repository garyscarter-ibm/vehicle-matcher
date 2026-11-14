package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RetainedPolicyFileTest {

    static final Instant T0 = Instant.parse("2026-11-05T09:00:00Z");

    @TempDir Path dir;

    PolicyReading read(Consumer<ObjectNode> edit) throws Exception {
        ObjectNode doc = (ObjectNode) SupplyFixture.resource("policy.json").deepCopy();
        edit.accept(doc);
        Path file = dir.resolve("policy.json");
        Files.writeString(file, doc.toString());
        return new RetainedPolicyFile(file).read("run-1", T0);
    }

    ObjectNode row(ObjectNode doc, String key) {
        for (JsonNode r : doc.get("assumptions")) if (key.equals(r.get("key").asText())) return (ObjectNode) r;
        throw new IllegalStateException(key);
    }

    @Test
    void readsTheThreeKeys() throws Exception {
        PolicyReading.Ok ok = assertInstanceOf(PolicyReading.Ok.class, read(d -> {}));
        assertEquals("test-policy-v1", ok.policyVersion());
        assertEquals(100, ok.releaseSize());
        assertEquals(1, ok.leadTimeDays());
        assertEquals(60, ok.stockSourceMaxAgeMinutes());
    }

    @Test
    void anythingMissingWrongOrOutOfRangeIsUnavailable() throws Exception {
        JsonNode original = SupplyFixture.resource("policy.json");
        for (String key : new String[] {"supply.release.size", "supply.leadTimeDays", "supply.stockSource.maxAgeMinutes"}) {
            assertInstanceOf(PolicyReading.Unavailable.class, read(d -> {
                ArrayNode kept = d.putArray("assumptions");
                for (JsonNode r : original.get("assumptions")) {
                    if (!key.equals(r.get("key").asText())) kept.add(r);
                }
            }), key);
            assertInstanceOf(PolicyReading.Unavailable.class, read(d -> row(d, key).put("policyVersion", "other")), key);
            assertInstanceOf(PolicyReading.Unavailable.class, read(d -> row(d, key).put("value", "ten")), key);
            assertInstanceOf(PolicyReading.Unavailable.class, read(d -> row(d, key).put("value", 1.5)), key);
        }
        assertInstanceOf(PolicyReading.Unavailable.class, read(d -> row(d, "supply.release.size").put("value", 0)));
        assertInstanceOf(PolicyReading.Unavailable.class, read(d -> row(d, "supply.leadTimeDays").put("value", -1)));
        assertInstanceOf(PolicyReading.Unavailable.class,
                read(d -> row(d, "supply.stockSource.maxAgeMinutes").put("unit", "hours")));
        assertInstanceOf(PolicyReading.Ok.class, read(d -> row(d, "supply.leadTimeDays").put("value", 0)));
    }

    @Test
    void futureEffectiveFromOrUnreadableFileIsUnavailable() throws Exception {
        assertInstanceOf(PolicyReading.Unavailable.class, read(d -> d.put("effectiveFrom", "2026-11-06T00:00:00.000Z")));
        assertInstanceOf(PolicyReading.Unavailable.class, read(d -> d.remove("policyVersion")));
        assertInstanceOf(PolicyReading.Unavailable.class,
                new RetainedPolicyFile(dir.resolve("absent.json")).read("run-1", T0));
        Path junk = dir.resolve("junk.json");
        Files.writeString(junk, "{not json");
        assertInstanceOf(PolicyReading.Unavailable.class, new RetainedPolicyFile(junk).read("run-1", T0));
        assertInstanceOf(PolicyReading.Unavailable.class, new UnconfiguredPolicy().read("run-1", T0));
    }
}
