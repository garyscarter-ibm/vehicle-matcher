package gcsp.api.learning;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.net.URLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.concurrent.TimeUnit;

/** The retained artifacts packaged under gcsp/learning/artifacts/ (the pom reads docs/gcsp/models/artifacts in place). */
public final class ClasspathArtifactStore implements ArtifactStore {

    public static final String ROOT = "gcsp/learning/artifacts/";

    private final ClassLoader loader = ClasspathArtifactStore.class.getClassLoader();

    @Override
    public Stat stat(String fileName) {
        URL url = loader.getResource(ROOT + fileName);
        if (url == null) return null;
        try {
            if ("file".equals(url.getProtocol())) {
                BasicFileAttributes attrs = Files.readAttributes(Path.of(url.toURI()), BasicFileAttributes.class);
                return new Stat(attrs.size(), attrs.lastModifiedTime().to(TimeUnit.NANOSECONDS));
            }
            URLConnection connection = url.openConnection();
            try (InputStream ignored = connection.getInputStream()) {
                return new Stat(connection.getContentLengthLong(), connection.getLastModified() * 1_000_000L);
            }
        } catch (IOException | java.net.URISyntaxException | RuntimeException e) {
            return null;
        }
    }

    @Override
    public byte[] read(String fileName, int limit) throws IOException {
        try (InputStream in = loader.getResourceAsStream(ROOT + fileName)) {
            if (in == null) throw new IOException("missing");
            return in.readNBytes(limit + 1);
        }
    }
}
