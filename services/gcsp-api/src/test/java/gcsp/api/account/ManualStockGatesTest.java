package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.recommendation.RecommendationConfig;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

/** The licence and insurance gates of the manual stock browse (Node #browseStock), with no database. */
class ManualStockGatesTest {

    private static final com.fasterxml.jackson.databind.node.JsonNodeFactory F = GoldenFixture.JSON.getNodeFactory();
    private static final RecommendationConfig CONFIG = new RecommendationConfig(
            F.objectNode().set("confirmedAssurances", F.arrayNode().add("confirmed-build").add("synthetic-scenario")));

    private static JsonNode licence() {
        return new GoldenFixture("paula").manual().get("drivers").get(0).get("licence").deepCopy();
    }

    private static JsonNode licence(Consumer<ObjectNode> edit) {
        ObjectNode l = (ObjectNode) licence();
        edit.accept(l);
        return l;
    }

    private static ObjectNode insurance(int group, String assurance) {
        ObjectNode fact = F.objectNode().put("status", "known").put("value", group).put("unit", "insurance-group");
        fact.putObject("provenance").put("sourceRef", "fixture").put("version", "v1")
                .put("observedAt", "2026-11-05T08:00:00.000Z").put("assurance", assurance);
        return fact;
    }

    private static void licenceIs(JsonNode l, String date, boolean blocker, String code) {
        ManualStock.Finding f = ManualStock.licenceGate(l, date);
        assertEquals(blocker, f.blocker());
        assertEquals(code, f.entry().get("code").asText());
        assertEquals(1, f.entry().size());
    }

    @Test
    void aConfirmedLicenceValidAtCollectionRaisesNothing() {
        assertNull(ManualStock.licenceGate(licence(), "2026-11-12"));
        assertNull(ManualStock.licenceGate(licence(), "2010-01-01"), "validFrom is inclusive");
        assertNull(ManualStock.licenceGate(licence(), "2030-01-01"), "validUntil is inclusive");
    }

    @Test
    void unconfirmedLicenceFactsAreAnUnknownNeverABlocker() {
        licenceIs(licence(l -> l.remove("validUntil")), "2026-11-12", false, "licence-unconfirmed");
        licenceIs(licence(l -> l.put("validFrom", "10/01/2010")), "2026-11-12", false, "licence-unconfirmed");
        licenceIs(licence(l -> l.put("categories", "car")), "2026-11-12", false, "licence-unconfirmed");
        licenceIs(licence(l -> l.remove("source")), "2026-11-12", false, "licence-unconfirmed");
        licenceIs(licence(l -> ((ObjectNode) l.get("source")).put("mode", "guess")), "2026-11-12", false, "licence-unconfirmed");
        licenceIs(F.nullNode(), "2026-11-12", false, "licence-unconfirmed");
    }

    @Test
    void aLicenceNotValidForACarOnTheDateIsABlocker() {
        licenceIs(licence(), "2030-01-02", true, "licence-not-valid-at-collection");
        licenceIs(licence(), "2009-12-31", true, "licence-not-valid-at-collection");
        licenceIs(licence(l -> l.putArray("categories").add("bus")), "2026-11-12", true, "licence-not-valid-at-collection");
        licenceIs(licence(l -> l.putArray("categories")), "2026-11-12", true, "licence-not-valid-at-collection");
    }

    @Test
    void insuranceWithinTheGradeMaximumRaisesNothing() {
        assertNull(ManualStock.insuranceGate(F.numberNode(35), insurance(20, "confirmed-build"), CONFIG));
        assertNull(ManualStock.insuranceGate(F.numberNode(35), insurance(35, "synthetic-scenario"), CONFIG), "equal is allowed");
    }

    @Test
    void insuranceOverTheMaximumIsABlockerWithTheNodeEvidence() {
        ManualStock.Finding f = ManualStock.insuranceGate(F.numberNode(35), insurance(40, "confirmed-build"), CONFIG);
        assertTrue(f.blocker());
        assertEquals("insurance-grade-limit", f.entry().get("code").asText());
        assertEquals(35, f.entry().get("maximum").asInt());
        assertEquals(40, f.entry().get("actual").asInt());
        assertEquals("manual.context.v1", f.entry().get("assumptionKey").asText());
        assertEquals(4, f.entry().size());
    }

    @Test
    void anUnconfirmedOrMissingInsuranceFactOrMaximumIsAnUnknown() {
        for (ManualStock.Finding f : new ManualStock.Finding[] {
            ManualStock.insuranceGate(F.numberNode(35), null, CONFIG),
            ManualStock.insuranceGate(F.numberNode(35), F.nullNode(), CONFIG),
            ManualStock.insuranceGate(F.numberNode(35), insurance(20, "model-reference"), CONFIG),
            ManualStock.insuranceGate(F.numberNode(35), insurance(20, "confirmed-build").put("status", "unknown"), CONFIG),
            ManualStock.insuranceGate(F.numberNode(35), insurance(20, "confirmed-build").put("value", "20"), CONFIG),
            ManualStock.insuranceGate(null, insurance(20, "confirmed-build"), CONFIG),
            ManualStock.insuranceGate(F.textNode("35"), insurance(20, "confirmed-build"), CONFIG)}) {
            assertFalse(f.blocker());
            assertEquals("insurance-unconfirmed", f.entry().get("code").asText());
        }
    }
}
