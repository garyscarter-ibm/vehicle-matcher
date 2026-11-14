package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import org.junit.jupiter.api.Test;

/** Canonical text and digests must equal Node's canonicalContent/inputDigest byte for byte. */
class CanonicalJsonTest {

    @Test
    void everyGoldenVectorMatchesNode() throws IOException {
        JsonNode vectors = EvidenceFixtures.golden("s1-canonical.json").get("vectors");
        assertFalse(vectors.isEmpty());
        for (JsonNode vector : vectors) {
            JsonNode parsed = StrictJson.parse(vector.get("text").textValue().getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    vector.get("text").textValue().getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
            assertEquals(vector.get("canonical").textValue(), CanonicalJson.canonical(parsed), vector.get("text").textValue());
            assertEquals(vector.get("digest").textValue(), CanonicalJson.digest(parsed), vector.get("text").textValue());
        }
    }

    @Test
    void numbersFollowEcmaScriptFormatting() {
        assertEquals("0", CanonicalJson.numberToString(-0.0));
        assertEquals("1e+21", CanonicalJson.numberToString(1e21));
        assertEquals("100000000000000000000", CanonicalJson.numberToString(1e20));
        assertEquals("1e-7", CanonicalJson.numberToString(1e-7));
        assertEquals("0.000001", CanonicalJson.numberToString(0.000001));
        assertEquals("1.5e+300", CanonicalJson.numberToString(1.5e300));
        assertEquals("-3.25", CanonicalJson.numberToString(-3.25));
        assertEquals("5e-324", CanonicalJson.numberToString(Double.MIN_VALUE));
        assertEquals("1.7976931348623157e+308", CanonicalJson.numberToString(Double.MAX_VALUE));
    }

    @Test
    void rowDigestsAndConfigurationHashesMatchNode() throws IOException {
        for (JsonNode store : EvidenceFixtures.golden("s1-canonical.json").get("rows")) {
            java.nio.file.Path root = EvidenceFixtures.required(EvidenceFixtures.REAL.resolve(store.get("store").textValue()));
            CorpusStore corpus = new CorpusStore(root.toAbsolutePath());
            assertEquals("ok", corpus.load().status());
            for (JsonNode expected : store.get("configurations")) {
                var result = corpus.getConfiguration(expected.get("configurationId").textValue());
                assertEquals(expected.get("recordDigest").textValue(), CanonicalJson.digest(result.record()));
            }
            for (JsonNode check : store.get("hashChecks")) {
                var result = corpus.getConfiguration(check.get("configurationId").textValue());
                String hash = CanonicalJson.digest(result.record().get("configuration"));
                assertEquals(check.get("configurationDigest").textValue(), hash);
                assertEquals(check.get("vinConfigurationHash").textValue(), hash);
            }
        }
    }
}
