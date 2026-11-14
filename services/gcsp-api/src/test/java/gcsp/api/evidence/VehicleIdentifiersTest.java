package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

/** Canonical identifier checks must agree with Node canonicalVehicleIdentifier on every recorded vector. */
class VehicleIdentifiersTest {

    @Test
    void identifierVectorsMatchNode() {
        JsonNode vectors = EvidenceFixtures.golden("s2-identifiers.json").get("vectors");
        assertTrue(vectors.size() >= 100, "vector count");
        for (JsonNode vector : vectors) {
            JsonNode kind = vector.get("kind");
            JsonNode id = vector.get("id");
            String actual = VehicleIdentifiers.canonical(kind.isNull() ? null : kind.textValue(), id.isTextual() ? id.textValue() : null);
            JsonNode expected = vector.get("canonical");
            assertEquals(expected.isNull() ? null : expected.textValue(), actual,
                    "kind=" + kind + " id=" + abbreviate(id.toString()));
        }
    }

    @Test
    void vinTrimUppercasesOnlyAsciiLetters() {
        assertEquals("ZZZZZZZZ0ZZ000000", VehicleIdentifiers.canonical("vin", "  zzzzzzzz0zz000000  "));
        assertEquals(null, VehicleIdentifiers.canonical("vin", "ZZZZZZZZIZ0000000"));
        assertEquals(null, VehicleIdentifiers.canonical("vin", "1234567"));
    }

    private static String abbreviate(String text) {
        return text.length() > 80 ? text.substring(0, 80) + "..." : text;
    }
}
