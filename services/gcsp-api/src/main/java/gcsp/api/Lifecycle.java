package gcsp.api;

import io.quarkus.runtime.ShutdownEvent;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Startup and shutdown markers that hosts and the local proof grep for. */
@ApplicationScoped
public class Lifecycle {

    private static final Logger LOG = Logger.getLogger(Lifecycle.class);

    @ConfigProperty(name = "quarkus.http.port")
    int port;

    void started(@Observes StartupEvent e) {
        LOG.infof("GCSP API started on port %d (java %s)", port, System.getProperty("java.version"));
    }

    void stopping(@Observes ShutdownEvent e) {
        LOG.info("GCSP API stopping: draining in-flight requests");
    }
}
