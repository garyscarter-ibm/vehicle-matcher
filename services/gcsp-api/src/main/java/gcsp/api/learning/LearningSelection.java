package gcsp.api.learning;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Chooses the artifact store once at startup: the classpath copy, or GCSP_LEARNING_ARTIFACT_DIR when set. */
@ApplicationScoped
@Startup
public class LearningSelection {

    private static final Logger LOG = Logger.getLogger(LearningSelection.class);

    @ConfigProperty(name = "gcsp.learning.artifact-dir")
    Optional<String> artifactDir;

    private volatile ModelArtifacts artifacts;

    @PostConstruct
    void init() {
        artifacts = select(artifactDir.orElse(null));
        LOG.info("GCSP learned artifacts: " + (artifactDir.filter(s -> !s.isBlank()).isPresent() ? "directory" : "classpath"));
    }

    public ModelArtifacts artifacts() {
        return artifacts;
    }

    /** Pure selection rule, static so every refusal is unit-testable. Blank means the classpath store. */
    public static ModelArtifacts select(String dir) {
        if (dir == null || dir.isBlank()) return new ModelArtifacts(new ClasspathArtifactStore());
        Path path = Path.of(dir.trim());
        if (!path.isAbsolute()) throw new IllegalStateException("gcsp.learning.artifact-dir must be an absolute path");
        if (!Files.isDirectory(path)) throw new IllegalStateException("gcsp.learning.artifact-dir is set but is not an existing directory");
        return new ModelArtifacts(new DirectoryArtifactStore(path));
    }
}
