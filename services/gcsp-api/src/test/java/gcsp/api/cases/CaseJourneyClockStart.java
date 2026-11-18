package gcsp.api.cases;

import gcsp.api.clock.ClockResult;
import gcsp.api.clock.RunClock;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import org.eclipse.microprofile.config.ConfigProvider;

/**
 * FUCQ-523: starts the run clock on a pinned wall day, after the database claim and before the demo preparation, so
 * the journey never depends on today's date. Inert unless the profile sets {@link #PROPERTY}.
 */
@ApplicationScoped
public class CaseJourneyClockStart {

    static final String PROPERTY = "gcsp.test.case-journey.clock-wall";
    /** After Persistence's default-priority claim, before ScenarioWiring's APPLICATION + 750. */
    static final int AFTER_CLAIM = jakarta.interceptor.Interceptor.Priority.APPLICATION + 600;

    @Inject
    Persistence persistence;

    @Inject
    PolicyService policy;

    @Inject
    Instance<AgroalDataSource> dataSource;

    void onStart(@Observes @Priority(AFTER_CLAIM) StartupEvent event) {
        String wall = ConfigProvider.getConfig().getOptionalValue(PROPERTY, String.class).orElse(null);
        if (wall == null || wall.isBlank() || !persistence.active()) return;
        var run = persistence.guard().currentRun();
        ClockResult r = new RunClock(dataSource.get(), persistence.runner(), policy, List.of(),
                InstantSource.fixed(Instant.parse(wall))).initialize(run.environmentId(), run.runId());
        if (r instanceof ClockResult.Failure f) throw new IllegalStateException("pinned clock start failed: " + f.code());
    }
}
