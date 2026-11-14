package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

/** The URL safety rules must accept and reject exactly what Node's WHATWG URL parser let through. */
class UrlParityTest {

    @Test
    void referenceRulesAgreeWithNodeForEveryRecordedUrl() {
        JsonNode cases = EvidenceFixtures.golden("s4-urls.json").get("cases");
        assertTrue(cases.size() > 150, "case count");
        for (JsonNode entry : cases) {
            String url = entry.get("url").textValue();
            assertEquals(entry.get("asset").booleanValue(), SafeReferences.safeReference(url), "asset " + url);
            assertEquals(entry.get("source").booleanValue(), SafeReferences.safeSourceReference(url) && !url.isEmpty()
                    && ContractChecks.textOk(url), "source " + url);
            assertEquals(entry.get("v2Source").booleanValue(), SafeReferences.safeV2SourceReference(url) && ContractChecks.textOk(url),
                    "v2 source " + url);
        }
    }
}
