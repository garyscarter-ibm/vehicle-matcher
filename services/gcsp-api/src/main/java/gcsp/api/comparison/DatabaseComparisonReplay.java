package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.arc.DefaultBean;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Optional;
import java.util.function.Function;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** The container's replay: RouteReplay over scratch schemas of the configured database, reading policy under the active run. */
@DefaultBean
@ApplicationScoped
public class DatabaseComparisonReplay implements ComparisonReplay {

    @Inject
    ComparisonService service;

    @ConfigProperty(name = "quarkus.datasource.jdbc.url")
    Optional<String> url;

    @ConfigProperty(name = "quarkus.datasource.username")
    Optional<String> user;

    @ConfigProperty(name = "quarkus.datasource.password")
    Optional<String> password;

    private Function<String, DataSource> sources;
    private String runId;
    private RouteReplay delegate;

    @PostConstruct
    void wire() {
        sources = new ScratchSchemaSources(url, user, password);
    }

    @Override
    public JsonNode replay(Request request) {
        return routeReplay(service.scope("comparison").runId()).replay(request);
    }

    // One RouteReplay per run id keeps a seed's evaluation cache shared by its current and buddy routes.
    private synchronized RouteReplay routeReplay(String activeRunId) {
        if (delegate == null || !activeRunId.equals(runId)) {
            delegate = new RouteReplay(sources, activeRunId);
            runId = activeRunId;
        }
        return delegate;
    }
}
