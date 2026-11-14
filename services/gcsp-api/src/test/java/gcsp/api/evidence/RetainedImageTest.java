package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import gcsp.api.evidence.DisplayCatalogue.RetainedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Retained image serving, asset verification failures and tampering. */
class RetainedImageTest {

    private static final String ASSETS = "assets/gcsp-vehicle-evidence/";
    private static final String REF_CONFIG = "UkVGMTpSRUZFUkVOQ0U=";
    private static final String GALLERY_CONFIG = EvidenceFixtures.golden("s3-full.json").get("cases").get(0).get("id").textValue();

    @Test
    void retainedImagesEqualNodeForTwentyMappedAndThreeUnknownIds() {
        JsonNode golden = EvidenceFixtures.golden("s3-images.json");
        DisplayCatalogue catalogue = DecoratorFixtures.catalogue();
        assertEquals(golden.get("mappingSize").intValue(), catalogue.imageCount(), "mapping size");
        assertEquals(23, golden.get("cases").size());
        for (JsonNode entry : golden.get("cases")) {
            String id = entry.get("imageId").textValue();
            Optional<RetainedImage> image = catalogue.retainedImage(id);
            JsonNode expected = entry.get("expected");
            if (expected.isNull()) {
                assertTrue(image.isEmpty(), id);
                continue;
            }
            assertEquals(expected.get("sha256").textValue(), CanonicalJson.sha256Hex(image.orElseThrow().bytes()), id);
            assertEquals(expected.get("bytes").intValue(), image.get().bytes().length, id);
            assertEquals("image/webp", image.get().contentType());
        }
    }

    @Test
    void everyMappedImageServesTheSameBytesNodeServed() {
        JsonNode golden = EvidenceFixtures.golden("s3-images.json");
        DisplayCatalogue catalogue = DecoratorFixtures.catalogue();
        ArrayNode served = EvidenceFixtures.MAPPER.createArrayNode();
        for (String id : catalogue.imageIds()) {
            catalogue.retainedImage(id).ifPresent(image ->
                    served.add(EvidenceFixtures.MAPPER.createArrayNode().add(id).add(CanonicalJson.sha256Hex(image.bytes()))));
        }
        assertEquals(golden.get("servedCount").intValue(), served.size());
        assertEquals(golden.get("servedDigest").textValue(), CanonicalJson.digest(served));
    }

    @Test
    void injectedAssetFailuresDropTheSameViewsAsNode() {
        JsonNode golden = EvidenceFixtures.golden("s3-failures.json");
        JsonNode record = LookupCases.store("fleet-source.v1").getConfiguration(
                golden.get("cases").get(0).get("configurationId").textValue()).record();
        assertNull(LookupCases.diff("$", golden.get("baseline"), asArray(DecoratorFixtures.catalogue().gallery(record))));
        for (JsonNode entry : golden.get("cases")) {
            String asset = entry.get("asset").textValue();
            String kind = entry.get("kind").textValue();
            DisplayCatalogue catalogue = new DisplayCatalogue(DecoratorFixtures.CATALOGUE, DecoratorFixtures.REPO, image -> {
                byte[] bytes = Files.readAllBytes(DecoratorFixtures.REPO.resolve(image.get("asset").textValue()));
                if (!image.get("asset").textValue().equals(asset)) return bytes;
                if (kind.equals("throw")) throw new IOException("asset unreadable");
                if (kind.equals("truncate")) return java.util.Arrays.copyOf(bytes, bytes.length - 1);
                bytes[bytes.length >> 1] ^= (byte) 0xff;
                return bytes;
            });
            assertNull(LookupCases.diff("$", entry.get("gallery"), asArray(catalogue.gallery(record))), entry.get("name").textValue());
        }
    }

    @Test
    void tamperedCatalogueAddsNoImagesAndLeavesTheUndecoratedProjection(@TempDir Path dir) throws IOException {
        Path copy = dir.resolve("display-images.v1.json");
        byte[] bytes = Files.readAllBytes(DecoratorFixtures.CATALOGUE);
        int at = new String(bytes, java.nio.charset.StandardCharsets.UTF_8).indexOf("2026-11-10");
        bytes[at + 9] = '1';
        Files.write(copy, bytes);
        DisplayCatalogue tampered = new DisplayCatalogue(copy, DecoratorFixtures.REPO);
        assertFalse(tampered.available());
        assertEquals(0, tampered.imageCount());
        assertTrue(tampered.retainedImage(DecoratorFixtures.catalogue().imageIds().get(0)).isEmpty());
        JsonNode undecorated = EvidenceFixtures.golden("s2-digests.json");
        for (String store : List.of("lookup-reference.v1", "demo-fleet.v1")) {
            VehicleEvidenceLookup lookup = DecoratorFixtures.lookup(store, tampered, null);
            List<String> ids = new ArrayList<>();
            try {
                ids.addAll(DecoratorParityTest.configurationIds(store));
            } catch (Exception e) {
                throw new AssertionError(e);
            }
            for (int i = 0; i < ids.size(); i++) {
                var result = lookup.resolve(new EvidenceRequest("configuration", ids.get(i), null), null);
                assertEquals(undecorated.get(store).get("configurations").get(i).textValue(), CanonicalJson.digest(result), store + " " + i);
            }
        }
    }

    @Test
    void tamperedDefinitionSeedGivesNodesUnavailableResolution(@TempDir Path dir) throws IOException {
        Path copy = dir.resolve("configuration-definitions.v1.json");
        byte[] bytes = Files.readAllBytes(DecoratorFixtures.SEED);
        bytes[bytes.length / 2] ^= 1;
        Files.write(copy, bytes);
        ConfigurationDefinitions tampered = new ConfigurationDefinitions(copy);
        assertFalse(tampered.available());
        JsonNode golden = EvidenceFixtures.golden("s3-full.json").get("seedUnavailable");
        assertNull(LookupCases.diff("$", golden.get("status"), tampered.definitionStatus()));
        VehicleEvidenceLookup lookup = DecoratorFixtures.lookup("lookup-reference.v1", null, tampered);
        assertNull(LookupCases.diff("$", golden.get("configuration"),
                lookup.resolve(new EvidenceRequest("configuration", REF_CONFIG, null), null)));
        assertNull(LookupCases.diff("$", golden.get("vin"),
                lookup.resolve(new EvidenceRequest("vin", "WBA33DB08TC426611", null), null)));
        assertFalse(new ConfigurationDefinitions(dir.resolve("absent.json")).available());
    }

    @Test
    void tamperedAssetDropsOnlyThatViewAndIsNeverServed(@TempDir Path root) throws IOException {
        DisplayCatalogue real = DecoratorFixtures.catalogue();
        JsonNode record = LookupCases.store("lookup-reference.v1").getConfiguration(GALLERY_CONFIG).record();
        List<JsonNode> views = real.gallery(record);
        assertEquals(3, views.size());
        Files.createDirectories(root.resolve(ASSETS));
        for (JsonNode view : views) {
            Files.copy(DecoratorFixtures.REPO.resolve(view.get("asset").textValue()), root.resolve(view.get("asset").textValue()));
        }
        DisplayCatalogue intact = new DisplayCatalogue(DecoratorFixtures.CATALOGUE, root);
        assertEquals(3, intact.gallery(record).size());
        Path target = root.resolve(views.get(1).get("asset").textValue());
        byte[] bytes = Files.readAllBytes(target);
        bytes[bytes.length / 2] ^= (byte) 0xff;
        Files.write(target, bytes);
        DisplayCatalogue tampered = new DisplayCatalogue(DecoratorFixtures.CATALOGUE, root);
        List<JsonNode> kept = tampered.gallery(record);
        assertEquals(List.of(views.get(0).get("imageId"), views.get(2).get("imageId")),
                kept.stream().map(view -> view.get("imageId")).toList());
        assertTrue(tampered.retainedImage(views.get(1).get("imageId").textValue()).isEmpty());
        assertTrue(tampered.retainedImage(views.get(0).get("imageId").textValue()).isPresent());
    }

    @Test
    void missingAssetsServeNothingAndNeverFallBack(@TempDir Path root) {
        DisplayCatalogue empty = new DisplayCatalogue(DecoratorFixtures.CATALOGUE, root);
        JsonNode record = LookupCases.store("lookup-reference.v1").getConfiguration(GALLERY_CONFIG).record();
        assertTrue(empty.gallery(record).isEmpty());
        assertTrue(empty.retainedImage(DecoratorFixtures.catalogue().imageIds().get(0)).isEmpty());
    }

    @Test
    void assetPathsMustResolveInsideTheAssetsDirectory(@TempDir Path root) {
        assertTrue(DisplayCatalogue.contained(root, ASSETS + "a".repeat(64) + ".webp") != null);
        assertNull(DisplayCatalogue.contained(root, ASSETS + "../../../etc/passwd"));
        assertNull(DisplayCatalogue.contained(root, "assets/other/" + "a".repeat(64) + ".webp"));
        assertNull(DisplayCatalogue.contained(root, "/etc/passwd"));
        assertNull(DisplayCatalogue.contained(root, ASSETS.substring(0, ASSETS.length() - 1)));
    }

    private static JsonNode asArray(List<JsonNode> nodes) {
        ArrayNode array = EvidenceFixtures.MAPPER.createArrayNode();
        nodes.forEach(array::add);
        return array;
    }
}
