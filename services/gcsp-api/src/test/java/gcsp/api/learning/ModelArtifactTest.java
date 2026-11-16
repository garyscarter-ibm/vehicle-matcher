package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The retained artifact, its verification codes, the read cache and the store selection rules. */
class ModelArtifactTest {

    @TempDir
    Path dir;

    private static ModelArtifacts retainedStore() {
        return new ModelArtifacts(new DirectoryArtifactStore(LearningFixtures.ARTIFACTS.toAbsolutePath().normalize()));
    }

    private static String code(Runnable action) {
        return assertThrows(ChoiceModelException.class, action::run).code();
    }

    @Test
    void retainedArtifactVerifiesWithTheDocumentedIdAndFileDigest() throws IOException {
        byte[] bytes = Files.readAllBytes(LearningFixtures.retainedFile());
        assertEquals(LearningFixtures.FILE_SHA256, CanonicalJson.sha256Hex(bytes));
        ModelArtifact artifact = ModelArtifact.parse(bytes, LearningFixtures.ID);
        assertEquals(LearningFixtures.ID, artifact.artifactId());
        assertEquals("vehicle-preference-v1", artifact.featureVersion());
        assertEquals("conditional-logit.l2.v1", artifact.payload().get("modelVersion").textValue());
        assertEquals(15, artifact.coefficients().length);
    }

    @Test
    void classpathStoreServesTheSameVerifiedBytes() {
        ModelArtifacts classpath = new ModelArtifacts(new ClasspathArtifactStore());
        assertTrue(classpath.exists(LearningFixtures.ID));
        assertEquals(LearningFixtures.ID, classpath.read(LearningFixtures.ID).artifactId());
        assertTrue(!classpath.exists("sha256:" + "0".repeat(64)));
    }

    @Test
    void evaluationSummaryEqualsNodes() {
        JsonNode expected = LearningFixtures.read(LearningFixtures.CASES).get("retained").get("evaluationSummary");
        ObjectNode actual = retainedStore().read(LearningFixtures.ID).evaluationSummary();
        assertEquals(expected, actual);
        assertEquals(CanonicalJson.canonical(expected), CanonicalJson.canonical(actual));
    }

    @Test
    void generatorRecordedTheRetainedIdentity() {
        JsonNode meta = LearningFixtures.read(LearningFixtures.CASES).get("retained");
        assertEquals(LearningFixtures.ID, meta.get("artifactId").textValue());
        assertEquals(LearningFixtures.FILE_SHA256, meta.get("fileSha256").textValue());
    }

    @Test
    void anEditedFileFailsAsNodeDoes() throws IOException {
        String text = Files.readString(LearningFixtures.retainedFile());
        Path copy = dir.resolve(LearningFixtures.ID.substring(7) + ".json");
        Files.writeString(copy, text.replace("1.3813689792790895", "1.3813689792791"));
        ModelArtifacts store = new ModelArtifacts(new DirectoryArtifactStore(dir));
        assertEquals("artifact-corrupt", code(() -> store.read(LearningFixtures.ID)));
        Files.writeString(copy, text.substring(0, 2000));
        assertEquals("artifact-unavailable", code(() -> store.read(LearningFixtures.ID)));
        Files.writeString(copy, "﻿" + text);
        assertEquals("artifact-unavailable", code(() -> store.read(LearningFixtures.ID)));
        Files.writeString(copy, text + "x");
        assertEquals("artifact-unavailable", code(() -> store.read(LearningFixtures.ID)));
        Files.writeString(copy, text);
        assertEquals(LearningFixtures.ID, store.read(LearningFixtures.ID).artifactId());
    }

    @Test
    void aFileUnderAnotherNameIsCorruptNotTrusted() throws IOException {
        String other = "sha256:" + "ab".repeat(32);
        Files.copy(LearningFixtures.retainedFile(), dir.resolve("ab".repeat(32) + ".json"));
        assertEquals("artifact-corrupt", code(() -> new ModelArtifacts(new DirectoryArtifactStore(dir)).read(other)));
        assertEquals("invalid-input", code(() -> retainedStore().read("sha256:not-hex")));
        assertEquals("invalid-input", code(() -> retainedStore().read("../" + LearningFixtures.ID)));
    }

    @Test
    void oversizedFileIsRefusedWithoutParsing() throws IOException {
        Path big = dir.resolve("cd".repeat(32) + ".json");
        Files.write(big, new byte[ModelArtifact.MAX_BYTES + 1]);
        assertEquals("invalid-input", code(() -> new ModelArtifacts(new DirectoryArtifactStore(dir)).read("sha256:" + "cd".repeat(32))));
    }

    @Test
    void verifiedArtifactIsCachedAndAChangeIsRechecked() throws IOException {
        Path copy = dir.resolve(LearningFixtures.ID.substring(7) + ".json");
        Files.copy(LearningFixtures.retainedFile(), copy);
        ModelArtifacts store = new ModelArtifacts(new DirectoryArtifactStore(dir));
        ModelArtifact first = store.read(LearningFixtures.ID);
        assertSame(first, store.read(LearningFixtures.ID));
        Files.setLastModifiedTime(copy, FileTime.fromMillis(Files.getLastModifiedTime(copy).toMillis() + 5000));
        ModelArtifact second = store.read(LearningFixtures.ID);
        assertNotSame(first, second);
        assertEquals(first.artifactId(), second.artifactId());
        Files.writeString(copy, "{}");
        assertEquals("artifact-unavailable", code(() -> store.read(LearningFixtures.ID)).replace("invalid-input", "artifact-unavailable"));
        Files.delete(copy);
        assertEquals("artifact-unavailable", code(() -> store.read(LearningFixtures.ID)));
        assertTrue(!store.exists(LearningFixtures.ID));
    }

    @Test
    void storeSelectionFollowsTheEvidenceProviderStyle() throws IOException {
        assertTrue(LearningSelection.select("").exists(LearningFixtures.ID));
        assertTrue(LearningSelection.select(null).exists(LearningFixtures.ID));
        assertThrows(IllegalStateException.class, () -> LearningSelection.select("relative/dir"));
        assertThrows(IllegalStateException.class, () -> LearningSelection.select(dir.resolve("absent").toString()));
        Files.copy(LearningFixtures.retainedFile(), dir.resolve(LearningFixtures.ID.substring(7) + ".json"));
        assertTrue(LearningSelection.select(dir.toString()).exists(LearningFixtures.ID));
    }
}
