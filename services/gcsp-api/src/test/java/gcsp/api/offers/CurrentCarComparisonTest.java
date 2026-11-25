package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

/** Frozen F105 producer/access vectors: comparison is historical evidence, never mutable account enrichment. */
class CurrentCarComparisonTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Instant NOW = Instant.parse("2026-11-23T11:30:00Z");
    private static final List<String> FIELDS = List.of("configuration", "body", "fuel", "seats", "boot", "mpg", "zeroTo62", "points");
    private static final CurrentCarComparison.Owner OWNER = new CurrentCarComparison.Owner("env-one", "run-one", "employee-one", "slot-one");
    private static final CurrentCarComparison.Scope SCOPE = new CurrentCarComparison.Scope(OWNER, 3, 2, NOW);

    @Test
    void theProducerCopiesOnlyEightRecordedFactsAndPinsTheSeparateSourceRevisions() throws Exception {
        ObjectNode rows = sourceRows(); ObjectNode before = rows.deepCopy();
        JsonNode pin = CurrentCarComparison.snapshot(SCOPE, rows);
        assertEquals(before, rows, "Snapshotting never changes the source read");
        assertTrue(pin.path("comparisonAvailable").asBoolean());
        assertEquals("available", pin.path("display").path("state").asText());
        assertEquals(FIELDS, keys(pin.path("display").path("facts")));
        assertEquals(1100, pin.path("display").path("facts").path("points").path("value").asInt());
        assertEquals("points-per-month", pin.path("display").path("facts").path("points").path("unit").asText());
        assertEquals("count", pin.path("display").path("facts").path("seats").path("unit").asText());
        assertEquals("L", pin.path("display").path("facts").path("boot").path("unit").asText());
        assertEquals("mpg-imperial", pin.path("display").path("facts").path("mpg").path("unit").asText());
        assertEquals("s", pin.path("display").path("facts").path("zeroTo62").path("unit").asText());
        assertEquals(3, pin.path("binding").path("employeeVersion").asInt());
        assertEquals(2, pin.path("binding").path("slotVersion").asInt());
        assertEquals(7, pin.path("binding").path("recordVersion").asInt(), "Account revision is independent of employee revision");
        assertEquals("record-one", pin.path("binding").path("recordSetId").asText());
        assertFalse(pin.toString().contains("excluded-sensitive"));
        ((ObjectNode) rows.path("accountRecord").path("record").path("contracts").get(0).path("vehicle")).put("points", 999);
        ((ObjectNode) contract(rows).path("source")).put("sourceVersion", "changed");
        assertEquals(1100, pin.path("display").path("facts").path("points").path("value").asInt());
        assertEquals("v1", pin.path("binding").path("source").path("sourceVersion").asText());
    }

    @Test
    void theProducerPreservesValidSubsetsAndModelOnlyProvenanceWithoutGuessingSpecifications() throws Exception {
        ObjectNode rows = sourceRows();
        ObjectNode vehicle = (ObjectNode) rows.path("accountRecord").path("record").path("contracts").get(0).path("vehicle");
        vehicle.put("configuration", " ").putObject("body").put("x", 1);
        vehicle.put("seats", "5").put("boot", -1).put("mpg", Double.NaN).put("zeroTo62", Double.POSITIVE_INFINITY);
        JsonNode partial = CurrentCarComparison.snapshot(SCOPE, rows);
        assertEquals("partial", partial.path("display").path("state").asText());
        assertTrue(partial.path("comparisonAvailable").asBoolean());
        assertEquals(List.of("fuel", "points"), keys(partial.path("display").path("facts")));
        assertEquals(JSON.valueToTree(List.of("configuration", "body", "seats", "boot", "mpg", "zeroTo62")), partial.path("display").path("unknowns"));
        vehicle.removeAll(); vehicle.put("body", "x".repeat(257)).put("seats", 0);
        JsonNode model = CurrentCarComparison.snapshot(SCOPE, rows);
        assertEquals("partial", model.path("display").path("state").asText());
        assertFalse(model.path("comparisonAvailable").asBoolean());
        assertFalse(model.path("display").has("facts"));
        assertEquals(JSON.valueToTree(FIELDS), model.path("display").path("unknowns"));
        assertEquals("BMW 3 Series Touring 320i", model.path("display").path("model").asText());
    }

    @Test
    void missingAmbiguousMismatchedFutureMalformedAndStaleSourcesStayUnavailable() throws Exception {
        Map<String, Consumer<ObjectNode>> invalid = new LinkedHashMap<>();
        invalid.put("missing-account", row -> row.remove("accountRecord"));
        invalid.put("missing-contracts", row -> ((ObjectNode) row.path("accountRecord").path("record")).remove("contracts"));
        invalid.put("duplicate-contract", row -> ((com.fasterxml.jackson.databind.node.ArrayNode) row.path("accountRecord").path("record").path("contracts"))
                .add(row.path("accountRecord").path("record").path("contracts").get(0).deepCopy()));
        invalid.put("contract-employee", row -> contract(row).put("employeeId", "other"));
        invalid.put("contract-slot", row -> contract(row).put("slotId", "other"));
        invalid.put("contract-scheme", row -> contract(row).put("schemeId", "other"));
        invalid.put("contract-id", row -> ((ObjectNode) row.path("slot").path("attributes")).put("contractId", "other"));
        invalid.put("returned", row -> contract(row).put("status", "returned"));
        invalid.put("empty-model", row -> contract(row).put("model", " "));
        invalid.put("other-run", row -> ((ObjectNode) row.path("slot")).put("runId", "other"));
        invalid.put("other-account-owner", row -> ((ObjectNode) row.path("accountRecord")).put("employeeId", "other"));
        invalid.put("other-environment", row -> ((ObjectNode) row.path("employee")).put("environmentId", "other"));
        invalid.put("employee-slot", row -> ((ObjectNode) row.path("employee").path("attributes")).put("entitlementSlotId", "other"));
        invalid.put("missing-company", row -> ((ObjectNode) row.path("employee").path("attributes")).remove("companyId"));
        invalid.put("stale-employee", row -> ((ObjectNode) row.path("employee")).put("version", 4));
        invalid.put("stale-slot", row -> ((ObjectNode) row.path("slot")).put("version", 3));
        invalid.put("zero-record-revision", row -> ((ObjectNode) row.path("accountRecord")).put("version", 0));
        invalid.put("record-set", row -> ((ObjectNode) row.path("accountRecord")).put("recordSetId", "other"));
        invalid.put("missing-contract-source", row -> contract(row).putNull("source"));
        invalid.put("future-effective", row -> recordSource(row).put("effectiveFrom", "2026-11-24T00:00:00Z"));
        invalid.put("future-observed", row -> recordSource(row).put("observedAt", "2026-11-24T00:00:00Z"));
        invalid.put("malformed-date", row -> recordSource(row).put("observedAt", "2026-02-30T00:00:00Z"));
        invalid.put("unsupported-source", row -> recordSource(row).put("mode", "unverified"));
        invalid.put("unbounded-version", row -> recordSource(row).put("sourceVersion", "x".repeat(257)));
        invalid.put("future-contract", row -> ((ObjectNode) contract(row).path("source")).put("observedAt", "2026-11-24T00:00:00Z"));
        for (var entry : invalid.entrySet()) {
            ObjectNode rows = sourceRows(); entry.getValue().accept(rows);
            JsonNode pin = CurrentCarComparison.snapshot(SCOPE, rows);
            assertEquals("unavailable", pin.path("display").path("state").asText(), entry.getKey());
            assertFalse(pin.path("comparisonAvailable").asBoolean(), entry.getKey());
            assertTrue(pin.path("display").path("model").isNull(), entry.getKey());
            assertTrue(pin.path("binding").path("contractId").isNull(), entry.getKey());
            assertTrue(pin.path("binding").path("source").isNull(), entry.getKey());
            assertUnavailable(CurrentCarComparison.project(pin, OWNER, NOW));
        }
    }

    @Test
    void aPinnedFullComparisonReachesThePublicOfferWithoutItsInternalBinding() throws Exception {
        ObjectNode pin = pin();
        JsonNode comparison = project(pin);
        assertEquals("available", comparison.path("status").asText());
        assertEquals("current-car-facts-recorded", comparison.path("reason").asText());
        assertTrue(comparison.path("comparisonAvailable").asBoolean());
        assertEquals(0, comparison.path("unknowns").size());
        assertEquals("BMW 3 Series Touring 320i", comparison.path("currentCar").path("model").asText());
        assertEquals(JSON.readTree("""
                {"configuration":{"value":"320i M Sport Touring","unit":null},"body":{"value":"estate","unit":null},
                 "fuel":{"value":"petrol","unit":null},"seats":{"value":5,"unit":"count"},
                 "boot":{"value":500,"unit":"L"},"mpg":{"value":42.8,"unit":"mpg-imperial"},
                 "zeroTo62":{"value":7.6,"unit":"s"},"points":{"value":1100,"unit":"points-per-month"}}
                """), comparison.path("currentCar").path("facts"));
        assertEquals(JSON.readTree("""
                {"mode":"synthetic","sourceVersion":"manual-records-v1","observedAt":"2026-11-05T09:00:00.000Z"}
                """), comparison.path("currentCar").path("source"));
        assertFalse(comparison.toString().contains("private-"));
        assertFalse(comparison.has("binding"));
        assertEquals(List.of("status", "reason", "comparisonAvailable", "currentCar", "unknowns"), keys(comparison));
        assertEquals(List.of("model", "source", "facts"), keys(comparison.path("currentCar")));
    }

    @Test
    void partialFactsArePartitionedAndInvalidValuesNeverBecomeComparisons() throws Exception {
        ObjectNode pin = pin();
        ((ObjectNode) pin.path("display").path("facts")).remove(List.of("configuration", "body", "seats", "boot", "mpg", "zeroTo62"));
        ((ObjectNode) pin.path("display")).put("state", "partial");
        ((ObjectNode) pin.path("display").path("facts")).putObject("boot").put("value", -1).put("unit", "L");
        JsonNode comparison = project(pin);
        assertEquals("partial", comparison.path("status").asText());
        assertTrue(comparison.path("comparisonAvailable").asBoolean());
        assertEquals(List.of("fuel", "points"), keys(comparison.path("currentCar").path("facts")));
        assertEquals(JSON.valueToTree(List.of("configuration", "body", "seats", "boot", "mpg", "zeroTo62")), comparison.path("unknowns"));
    }

    @Test
    void modelOnlyProvenanceIsPartialWithoutInventingFacts() throws Exception {
        ObjectNode pin = pin();
        ((ObjectNode) pin.path("display")).remove("facts");
        ((ObjectNode) pin.path("display")).put("state", "partial");
        pin.put("comparisonAvailable", false);
        JsonNode comparison = project(pin);
        assertEquals("partial", comparison.path("status").asText());
        assertEquals("current-car-facts-unavailable", comparison.path("reason").asText());
        assertFalse(comparison.path("comparisonAvailable").asBoolean());
        assertEquals("BMW 3 Series Touring 320i", comparison.path("currentCar").path("model").asText());
        assertFalse(comparison.path("currentCar").has("facts"));
        assertEquals(JSON.valueToTree(FIELDS), comparison.path("unknowns"));
    }

    @Test
    void oldUnpinnedAndInvalidOrFuturePinsStayUnavailable() throws Exception {
        assertUnavailable(project(null));
        ObjectNode wrongSchema = pin(); wrongSchema.put("schemaVersion", "2"); assertUnavailable(project(wrongSchema));
        ObjectNode future = pin(); ((ObjectNode) future.path("display").path("source")).put("observedAt", "2026-11-24T00:00:00Z");
        assertUnavailable(project(future));
        ObjectNode source = pin(); ((ObjectNode) source.path("display").path("source")).put("mode", "unverified");
        assertUnavailable(project(source));
    }

    @Test
    void offsetSourceTimesStayPinnedButThePublicComparisonUsesTheFrozenUnavailableFallback() throws Exception {
        ObjectNode rows = sourceRows();
        ((ObjectNode) contract(rows).path("source")).put("observedAt", "2026-11-05T09:00:00+00:00");
        ObjectNode pinned = CurrentCarComparison.snapshot(SCOPE, rows);
        assertEquals("available", pinned.path("display").path("state").asText());
        assertEquals("2026-11-05T09:00:00+00:00", pinned.path("display").path("source").path("observedAt").asText());
        assertUnavailable(project(pinned));
    }

    @Test
    void malformedPublicTextCannotMakeTheWholeOfferFailClientValidation() throws Exception {
        ObjectNode model = pin(); ((ObjectNode) model.path("display")).put("model", "BMW\n320i");
        assertUnavailable(project(model));
        ObjectNode version = pin(); ((ObjectNode) version.path("display").path("source")).put("sourceVersion", "v1\tprivate");
        assertUnavailable(project(version));
        ObjectNode fact = pin();
        ((ObjectNode) fact.path("display").path("facts").path("configuration")).put("value", "320i\nTouring");
        ((ObjectNode) fact.path("display").path("facts").path("points")).put("unit", "points\nper-month");
        JsonNode comparison = project(fact);
        assertEquals("partial", comparison.path("status").asText());
        assertEquals(JSON.valueToTree(List.of("configuration", "points")), comparison.path("unknowns"));
        assertFalse(comparison.path("currentCar").path("facts").has("configuration"));
        assertFalse(comparison.path("currentCar").path("facts").has("points"));
    }

    @Test
    void publicTextBoundariesMatchTheFrozenReaderWithoutTruncatingTheStoredPin() throws Exception {
        ObjectNode exact = pin();
        ((ObjectNode) exact.path("display")).put("model", "m".repeat(256));
        ((ObjectNode) exact.path("display").path("source")).put("sourceVersion", "v".repeat(128));
        ((ObjectNode) exact.path("display").path("facts").path("configuration")).put("value", "c".repeat(128));
        ((ObjectNode) exact.path("display").path("facts").path("points")).put("unit", "u".repeat(128));
        assertEquals("available", project(exact).path("status").asText());
        assertEquals("m".repeat(256), project(exact).path("currentCar").path("model").asText());
        ObjectNode model = exact.deepCopy(); ((ObjectNode) model.path("display")).put("model", "m".repeat(257));
        assertUnavailable(project(model));
        ObjectNode version = exact.deepCopy();
        ((ObjectNode) version.path("display").path("source")).put("sourceVersion", "v".repeat(129));
        assertUnavailable(project(version));
        ObjectNode facts = exact.deepCopy();
        ((ObjectNode) facts.path("display").path("facts").path("configuration")).put("value", "c".repeat(129));
        ((ObjectNode) facts.path("display").path("facts").path("points")).put("unit", "u".repeat(129));
        JsonNode comparison = project(facts);
        assertEquals("partial", comparison.path("status").asText());
        assertEquals(JSON.valueToTree(List.of("configuration", "points")), comparison.path("unknowns"));
        assertEquals(129, facts.path("display").path("facts").path("configuration").path("value").asText().length());
    }

    @Test
    void javascriptBlankTextRemainsUnknownRatherThanInvalidatingTheWholeOffer() throws Exception {
        for (String blank : List.of("\u00a0", "\ufeff", "\u2007", "\u202f", " \u00a0\ufeff ")) {
            ObjectNode model = pin(); ((ObjectNode) model.path("display")).put("model", blank);
            assertUnavailable(project(model));
            ObjectNode version = pin(); ((ObjectNode) version.path("display").path("source")).put("sourceVersion", blank);
            assertUnavailable(project(version));
            ObjectNode rows = sourceRows(); contract(rows).put("model", blank);
            assertEquals("unavailable", CurrentCarComparison.snapshot(SCOPE, rows).path("display").path("state").asText());
            ObjectNode fact = pin(); ((ObjectNode) fact.path("display").path("facts").path("configuration")).put("value", blank);
            assertEquals(JSON.valueToTree(List.of("configuration")), project(fact).path("unknowns"));
        }
    }

    @Test
    void numericSchemaAndIdentityValuesAreNotCoercedIntoAuthenticatedText() throws Exception {
        ObjectNode schema = pin(); schema.put("schemaVersion", 1); assertUnavailable(project(schema));
        ObjectNode rows = sourceRows();
        ((ObjectNode) rows.path("employee")).put("employeeId", "1");
        ((ObjectNode) rows.path("employee").path("attributes")).put("entitlementSlotId", "2");
        ((ObjectNode) rows.path("slot")).put("employeeId", "1").put("slotId", "2");
        ((ObjectNode) rows.path("slot").path("attributes")).put("contractId", "3");
        ((ObjectNode) rows.path("accountRecord")).put("employeeId", "1");
        contract(rows).put("contractId", "3").put("employeeId", "1").put("slotId", "2");
        var owner = new CurrentCarComparison.Owner("env-one", "run-one", "1", "2");
        var scope = new CurrentCarComparison.Scope(owner, 3, 2, NOW);
        ObjectNode valid = CurrentCarComparison.snapshot(scope, rows);
        assertEquals("available", valid.path("display").path("state").asText());
        for (String field : List.of("contractId", "employeeId", "slotId")) {
            ObjectNode malformed = rows.deepCopy();
            contract(malformed).put(field, Integer.parseInt(contract(malformed).path(field).asText()));
            assertEquals("unavailable", CurrentCarComparison.snapshot(scope, malformed).path("display").path("state").asText(), field);
        }
        ObjectNode slot = rows.deepCopy(); ((ObjectNode) slot.path("slot").path("attributes")).put("contractId", 3);
        assertEquals("unavailable", CurrentCarComparison.snapshot(scope, slot).path("display").path("state").asText());
        ObjectNode employeeSlot = rows.deepCopy();
        ((ObjectNode) employeeSlot.path("employee").path("attributes")).put("entitlementSlotId", 2);
        assertEquals("unavailable", CurrentCarComparison.snapshot(scope, employeeSlot).path("display").path("state").asText());
        ObjectNode binding = valid.deepCopy(); ((ObjectNode) binding.path("binding")).put("employeeId", 1);
        assertUnavailable(CurrentCarComparison.project(binding, owner, NOW));
    }

    @Test
    void sourceOffsetParsingMatchesTheExistingJavascriptContractWithoutChangingPublicZDates() throws Exception {
        for (String offset : List.of("+19:00", "+23:59", "-19:00", "-23:59")) {
            ObjectNode rows = sourceRows();
            recordSource(rows).put("effectiveFrom", "2026-11-01T09:00:00" + offset);
            ((ObjectNode) contract(rows).path("source")).put("effectiveFrom", "2026-11-01T09:00:00" + offset);
            JsonNode pinned = CurrentCarComparison.snapshot(SCOPE, rows);
            assertEquals("available", pinned.path("display").path("state").asText(), offset);
            assertEquals("2026-11-01T09:00:00" + offset, pinned.path("binding").path("source").path("effectiveFrom").asText());
            assertEquals("available", CurrentCarComparison.project(pinned, OWNER, NOW).path("status").asText());
        }
        for (String offset : List.of("+24:00", "+23:60")) {
            ObjectNode rows = sourceRows(); recordSource(rows).put("effectiveFrom", "2026-11-01T09:00:00" + offset);
            assertEquals("unavailable", CurrentCarComparison.snapshot(SCOPE, rows).path("display").path("state").asText());
        }
        ObjectNode future = sourceRows(); recordSource(future).put("observedAt", "2026-11-23T11:30:00-00:01");
        assertEquals("unavailable", CurrentCarComparison.snapshot(SCOPE, future).path("display").path("state").asText());
    }

    @Test
    void aComparisonPinForAnotherQuoteOwnerNeverCrossesThePublicBoundary() throws Exception {
        for (String field : List.of("environmentId", "runId", "employeeId", "slotId")) {
            ObjectNode other = pin(); ((ObjectNode) other.path("binding")).put(field, "other-" + field);
            assertUnavailable(project(other));
        }
    }

    private static void assertUnavailable(JsonNode comparison) {
        assertEquals("unavailable", comparison.path("status").asText());
        assertEquals("pinned-current-car-comparison-unavailable", comparison.path("reason").asText());
        assertFalse(comparison.path("comparisonAvailable").asBoolean());
        assertTrue(comparison.path("currentCar").isNull());
        assertEquals(JSON.valueToTree(FIELDS), comparison.path("unknowns"));
    }

    private static List<String> keys(JsonNode value) {
        java.util.ArrayList<String> keys = new java.util.ArrayList<>(); value.fieldNames().forEachRemaining(keys::add); return keys;
    }

    private static ObjectNode contract(ObjectNode rows) { return (ObjectNode) rows.path("accountRecord").path("record").path("contracts").get(0); }
    private static ObjectNode recordSource(ObjectNode rows) { return (ObjectNode) rows.path("accountRecord").path("record").path("source"); }

    private static ObjectNode sourceRows() throws Exception {
        return (ObjectNode) JSON.readTree("""
                {"employee":{"environmentId":"env-one","runId":"run-one","employeeId":"employee-one","version":3,
                   "attributes":{"companyId":"company-one","schemeId":"scheme-one","entitlementSlotId":"slot-one"}},
                 "slot":{"environmentId":"env-one","runId":"run-one","employeeId":"employee-one","slotId":"slot-one","version":2,
                   "attributes":{"contractId":"current-one"}},
                 "accountRecord":{"environmentId":"env-one","runId":"run-one","employeeId":"employee-one","recordSetId":"record-one","version":7,
                  "record":{"recordSetId":"record-one","account":{"address":"excluded-sensitive-account"},"drivers":[{"licence":"excluded-sensitive-driver"}],
                   "source":{"mode":"synthetic","sourceRef":"fixture:current-contract","sourceVersion":"v1","schemaVersion":"1",
                    "effectiveFrom":"2026-11-05T09:00:00.000Z","observedAt":"2026-11-05T09:00:00.000Z"},
                   "contracts":[{"contractId":"current-one","employeeId":"employee-one","slotId":"slot-one","schemeId":"scheme-one","status":"current",
                    "model":"BMW 3 Series Touring 320i","vin":"excluded-sensitive-vin",
                    "source":{"mode":"synthetic","sourceRef":"fixture:current-contract","sourceVersion":"v1","schemaVersion":"1",
                     "effectiveFrom":"2026-11-05T09:00:00.000Z","observedAt":"2026-11-05T09:00:00.000Z","extra":"excluded-sensitive-source"},
                    "vehicle":{"configuration":"320i M Sport Touring","body":"estate","fuel":"petrol","seats":5,"boot":500,"mpg":42.8,
                     "zeroTo62":7.6,"points":1100,"vin":"excluded-sensitive-vehicle"}}]}}}
                """);
    }

    private static ObjectNode pin() throws Exception {
        return (ObjectNode) JSON.readTree("""
                {"schemaVersion":"1","comparisonAvailable":true,"binding":{"contractId":"private-contract","employeeId":"employee-one",
                 "environmentId":"env-one","runId":"run-one","slotId":"slot-one",
                 "source":{"sourceRef":"private-source"},"recordSetId":"private-record-set","recordVersion":3},
                 "display":{"state":"available","model":"BMW 3 Series Touring 320i",
                  "source":{"mode":"synthetic","sourceVersion":"manual-records-v1","observedAt":"2026-11-05T09:00:00.000Z","sourceRef":"private-ref"},
                  "facts":{"configuration":{"value":"320i M Sport Touring","unit":null},"body":{"value":"estate","unit":null},
                   "fuel":{"value":"petrol","unit":null},"seats":{"value":5,"unit":"count"},"boot":{"value":500,"unit":"L"},
                   "mpg":{"value":42.8,"unit":"mpg-imperial"},"zeroTo62":{"value":7.6,"unit":"s"},
                   "points":{"value":1100,"unit":"points-per-month"},"vin":{"value":"private-vin","unit":null}},"unknowns":[]}}
                """);
    }

    private static JsonNode project(ObjectNode pin) throws Exception {
        ObjectNode quote = (ObjectNode) JSON.readTree("""
                {"gateStatus":"eligible","snapshot":{"contractVersion":"vehicle-snapshot-v1","candidateKey":"car-one",
                  "sourceNamespace":"fixture","identityKind":"exact-stock","snapshotVersion":"facts-v1","observedAt":"2026-11-05T09:00:00Z",
                  "sourceKeys":{"stockId":"car-one"},"facts":{},"display":{}},
                 "terms":{"kind":"employee-scheme","termsVersion":"terms-v1","validFrom":"2026-11-05T09:00:00Z",
                  "validUntil":"2026-11-24T09:00:00Z","points":{"value":800,"unit":"points-per-month"},"provenance":{},
                  "allowanceInputs":{"allowance":{}}}}
                """);
        if (pin != null) quote.set("currentCarComparison", pin);
        OfferView.Quote q = new OfferView.Quote("quote-one", "car-one", "config-one", "policy-one", "1", NOW,
                NOW.plusSeconds(7200), 800, "Offered car", null, "eligible");
        OfferView view = new OfferView("offer-one", "pending", "awaiting-decision", NOW, NOW.plusSeconds(7200), 1, 1,
                "active", "active", List.of("decline"), q);
        ObjectNode projected = FollowupComparison.offer(view, "run-one", "4", null, quote, null,
                new CurrentCarComparison.Owner("env-one", "run-one", "employee-one", "slot-one"));
        assertNotNull(projected, "The independent offer fixture satisfies the existing public projection contract");
        return projected.path("comparison");
    }
}
