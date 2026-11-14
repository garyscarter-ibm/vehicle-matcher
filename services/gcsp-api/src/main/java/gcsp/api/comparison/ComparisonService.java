package gcsp.api.comparison;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** The comparison seam for the resource and the startup import: the active run's scope, the store and the retained files. */
@ApplicationScoped
public class ComparisonService {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> sources;

    @ConfigProperty(name = "gcsp.comparison.result-files")
    Optional<String> resultFiles;

    public boolean available() {
        return persistence.active();
    }

    /** The pooled datasource the job rows are written through. */
    public DataSource dataSource() {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        return sources.get();
    }

    public ComparisonStore store() {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        return new ComparisonStore(sources.get());
    }

    /** The active run; the request never chooses the environment or the run. */
    public RunContext scope(String actorId) {
        var run = persistence.guard().currentRun();
        return new RunContext(run.environmentId(), run.runId(), actorId);
    }

    /** The configured absolute files, or none (use the bundled default) when blank. */
    List<Path> configuredFiles() {
        String raw = resultFiles.orElse("").trim();
        if (raw.isEmpty()) return List.of();
        return Arrays.stream(raw.split(",")).map(String::trim).filter(s -> !s.isEmpty()).map(Path::of).toList();
    }
}
