package gcsp.api.comparison;

import gcsp.api.comparison.RetainedComparisonResults.Retained;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.interceptor.Interceptor;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jboss.logging.Logger;

/** Imports the verified retained results once at startup; it never overwrites a row and never stops startup. */
@ApplicationScoped
public class ComparisonStartup {

    /** Later than Persistence's default-priority observer, so the environment claim comes first. */
    static final int AFTER_PERSISTENCE = Interceptor.Priority.LIBRARY_AFTER;
    private static final Logger LOG = Logger.getLogger(ComparisonStartup.class);

    @Inject
    ComparisonService service;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_PERSISTENCE) StartupEvent event) {
        importRetained();
    }

    /** Returns the number of rows added; refusals and database failures are logged, not thrown. */
    public int importRetained() {
        if (!service.available()) {
            summary = "skipped";
            return 0;
        }
        int added = 0;
        boolean failed = false;
        AtomicBoolean refused = new AtomicBoolean();
        try {
            List<Retained> results = RetainedComparisonResults.load(service.configuredFiles(), reason -> {
                refused.set(true);
                LOG.warnf("GCSP comparison import refused a result file: %s", reason);
            });
            String environmentId = service.scope("system").environmentId();
            ComparisonStore store = service.store();
            for (Retained r : results) {
                ComparisonStore.Inserted outcome = store.insert(environmentId, r, "retained");
                if (outcome == ComparisonStore.Inserted.NEW) added++;
                if (outcome == ComparisonStore.Inserted.CONFLICT) {
                    failed = true;
                    LOG.warnf("GCSP comparison import: %s already stored with a different digest; left unchanged", r.resultId());
                }
            }
        } catch (Exception e) {
            failed = true;
            LOG.warnf("GCSP comparison import failed (%s); startup continues", e.getClass().getSimpleName());
        }
        summary = failed || refused.get() ? "failed" : "imported:" + added;
        return added;
    }

    /** not-run, skipped, imported:N or failed. */
    public String summary() {
        return summary;
    }
}
