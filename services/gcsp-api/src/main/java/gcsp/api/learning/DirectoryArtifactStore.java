package gcsp.api.learning;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.concurrent.TimeUnit;

/** Artifacts in a trusted directory chosen by configuration (GCSP_LEARNING_ARTIFACT_DIR). */
public final class DirectoryArtifactStore implements ArtifactStore {

    private final Path directory;

    public DirectoryArtifactStore(Path directory) {
        this.directory = directory;
    }

    @Override
    public Stat stat(String fileName) {
        try {
            BasicFileAttributes attrs = Files.readAttributes(directory.resolve(fileName), BasicFileAttributes.class);
            return new Stat(attrs.size(), attrs.lastModifiedTime().to(TimeUnit.NANOSECONDS));
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    @Override
    public byte[] read(String fileName, int limit) throws IOException {
        try (InputStream in = Files.newInputStream(directory.resolve(fileName))) {
            return in.readNBytes(limit + 1);
        }
    }
}
