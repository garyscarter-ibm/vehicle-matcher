package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/** The startup rule for the evidence provider: no silent fallback, every unusable setting stops startup. */
class EvidenceSelectionTest {

    static final String STORE = EvidenceFixtures.REAL.resolve("lookup-reference.v1").toString();
    static final String REFERENCE = EvidenceFixtures.REAL.toString();
    static final String ASSETS = DecoratorFixtures.REPO.toString();
    static final String ALTERNATE = ProviderCases.ALTERNATE.toString();

    static EvidenceSelection.Selected select(String provider, String store, String reference, String assets, String alternate) {
        return EvidenceSelection.select(provider, store, reference, assets, alternate, 1000, 1, null);
    }

    @Test
    void noneIsTheDefaultAndNeverReadsAnything() {
        for (String name : new String[] {null, "", "  ", "none"}) {
            EvidenceSelection.Selected s = select(name, null, null, null, null);
            assertEquals("none", s.provider());
            assertNull(s.load());
            ObjectNode out = s.consumer().resolve(new EvidenceRequest("vin", "WBA33DB08TC426611", null), null);
            assertEquals("source-unavailable", out.get("status").textValue());
        }
    }

    @Test
    void lookupAndAlternateBuildOverTheStore() {
        EvidenceSelection.Selected lookup = select("lookup", STORE, REFERENCE, ASSETS, null);
        assertTrue(lookup.load().ready());
        assertTrue(lookup.catalogue().available() && lookup.definitions().available());
        assertEquals("ok", lookup.consumer().resolve(new EvidenceRequest("vin", "WBA33DB08TC426611", null), null).path("failure").isNull() ? "ok" : "bad");
        assertTrue(select("alternate-offline", STORE, REFERENCE, ASSETS, ALTERNATE).load().ready());
        assertTrue(EvidenceSelection.describe(lookup).contains("manifestDigest c1f80401"));
    }

    @Test
    void unknownProviderAndMissingOrRelativePathsRefuse() {
        assertThrows(IllegalStateException.class, () -> select("live", STORE, REFERENCE, ASSETS, null));
        assertThrows(IllegalStateException.class, () -> select("Lookup", STORE, REFERENCE, ASSETS, null));
        for (String provider : new String[] {"lookup", "alternate-offline"}) {
            assertThrows(IllegalStateException.class, () -> select(provider, null, REFERENCE, ASSETS, ALTERNATE));
            assertThrows(IllegalStateException.class, () -> select(provider, STORE, "", ASSETS, ALTERNATE));
            assertThrows(IllegalStateException.class, () -> select(provider, STORE, REFERENCE, null, ALTERNATE));
            assertThrows(IllegalStateException.class, () -> select(provider, "relative/store", REFERENCE, ASSETS, ALTERNATE));
            assertThrows(IllegalStateException.class, () -> select(provider, STORE, "relative", ASSETS, ALTERNATE));
            assertThrows(IllegalStateException.class, () -> select(provider, STORE + "-missing", REFERENCE, ASSETS, ALTERNATE));
            assertThrows(IllegalStateException.class, () -> select(provider, STORE, REFERENCE, ASSETS + "/missing", ALTERNATE));
        }
    }

    @Test
    void alternateNeedsAnExistingAbsoluteFile() {
        assertThrows(IllegalStateException.class, () -> select("alternate-offline", STORE, REFERENCE, ASSETS, null));
        assertThrows(IllegalStateException.class, () -> select("alternate-offline", STORE, REFERENCE, ASSETS, "alternate.json"));
        assertThrows(IllegalStateException.class, () -> select("alternate-offline", STORE, REFERENCE, ASSETS, ALTERNATE + ".missing"));
        assertThrows(IllegalStateException.class, () -> select("alternate-offline", STORE, REFERENCE, ASSETS, REFERENCE));
    }

    @Test
    void badBoundsRefuseAndACorruptStoreIsUnavailableNotFatal() {
        assertThrows(IllegalStateException.class, () -> EvidenceSelection.select("lookup", STORE, REFERENCE, ASSETS, null, 0, 1, null));
        assertThrows(IllegalStateException.class, () -> EvidenceSelection.select("lookup", STORE, REFERENCE, ASSETS, null, 1000, 3, null));
        String corrupt = EvidenceFixtures.RESOURCES.resolve("stores/checksum-corrupt").toString();
        EvidenceSelection.Selected s = select("lookup", corrupt, REFERENCE, ASSETS, null);
        assertTrue(!s.load().ready());
        assertNotNull(s.load().failure());
        assertEquals("source-unavailable", s.consumer().resolve(new EvidenceRequest("vin", "WBA33DB08TC426611", null), null).get("status").textValue());
    }

    @Test
    void decodeFollowsDecodeUriComponent() {
        assertEquals("a/b+c=", EvidenceResource.decode("a%2Fb%2Bc%3D"));
        assertEquals("a+b", EvidenceResource.decode("a+b"));
        assertEquals("é", EvidenceResource.decode("%C3%A9"));
        assertEquals("é", EvidenceResource.decode("é"));
        for (String bad : new String[] {"%", "%1", "%zz", "%C3", "%C3%28", "%FF"}) assertNull(EvidenceResource.decode(bad), bad);
        assertTrue(Files.isDirectory(Path.of(STORE)));
    }
}
