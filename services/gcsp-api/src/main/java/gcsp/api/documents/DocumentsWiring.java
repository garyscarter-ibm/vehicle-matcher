package gcsp.api.documents;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.DefaultBean;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Chooses the document provider once at startup (an unknown name stops startup) and builds the service over the
 * runner when persistence is on. Sibling Stories replace the unavailable defaults below with real ports.
 */
@ApplicationScoped
public class DocumentsWiring {

    private static final Logger LOG = Logger.getLogger(DocumentsWiring.class);

    @ConfigProperty(name = "gcsp.documents.provider", defaultValue = "none")
    String providerName;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    Instance<DocumentPolicyPort> policy;

    @Inject
    Instance<DocumentCasePort> cases;

    @Inject
    Instance<DocumentClock> clock;

    private volatile DocumentProviderPort provider;
    private volatile DocumentService service;

    void onStart(@Observes StartupEvent event) {
        provider();
    }

    synchronized DocumentProviderPort provider() {
        if (provider == null) {
            provider = DocumentProviderSelection.select(providerName);
            LOG.infof("Document provider: %s", provider.mode());
        }
        return provider;
    }

    /** Null while persistence is off, so callers answer unavailable instead of guessing. */
    public synchronized DocumentService service() {
        if (service == null && persistence.active()) {
            service = new DocumentService(persistence.runner(), dataSource.get(), policy.get(), cases.get(),
                    clock.get(), provider());
        }
        return service;
    }

    @DefaultBean
    @ApplicationScoped
    public static class UnavailableCasePort implements DocumentCasePort {
        @Override
        public StageRead readStage(gcsp.api.persistence.RunContext ctx, String orderUuid) {
            return new StageRead("unavailable", "stages-not-configured", null);
        }

        @Override
        public OrderList listOrders(gcsp.api.persistence.RunContext ctx) {
            return new OrderList("unavailable", "stages-not-configured", java.util.List.of(), java.util.List.of(), 0);
        }

        @Override
        public CaseCheck checkCase(gcsp.api.persistence.RunContext ctx, String employeeId, OrderAuthority order) {
            return new CaseCheck.Unavailable("employees-not-configured");
        }

        @Override
        public Owner ownerOf(gcsp.api.persistence.RunContext ctx, String orderUuid) {
            return new Owner.Unavailable("orders-not-configured");
        }
    }

    @DefaultBean
    @ApplicationScoped
    public static class UnavailableDocumentClock implements DocumentClock {
        @Override
        public Optional<java.time.Instant> now(gcsp.api.persistence.RunContext ctx) {
            return Optional.empty();
        }
    }
}
