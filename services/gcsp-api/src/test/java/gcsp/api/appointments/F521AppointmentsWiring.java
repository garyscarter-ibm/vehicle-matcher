package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.RunContext;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;

/** Selected only by F521 profiles; each HTTP call owns a scoped provider executor, all closed at shutdown. */
@Alternative
@ApplicationScoped
public class F521AppointmentsWiring extends AppointmentsWiring {
    private final List<AppointmentService> services = new ArrayList<>();
    static final AtomicReference<Control> HTTP_CONTROL = new AtomicReference<>();
    private static final ObjectMapper JSON = new ObjectMapper();

    @Override
    public synchronized AppointmentService service() {
        if (!persistence.active()) return null;
        DataSource ds = dataSource.get();
        ControlledAppointmentProvider provider = new ControlledAppointmentProvider(new SyntheticAppointments(ds));
        OrderStagePort stage = stages.get();
        AppointmentService service = new AppointmentService(ds, policy, provider, (run, order) -> {
            provider.observed.set(new Scope(run, order));
            return stage.read(run, order);
        }, new TickClock(ds), readiness.get());
        services.add(service);
        return service;
    }

    synchronized int createdServiceCount() {
        return services.size();
    }

    @PreDestroy
    synchronized void closeProofServices() {
        services.forEach(AppointmentService::close);
        services.clear();
    }

    record Scope(RunContext run, String orderUuid) {}

    record Control(String environmentId, String runId, String orderUuid, boolean offerUnavailable, boolean writePending) {
        boolean matches(RunContext run, String order) {
            return environmentId.equals(run.environmentId()) && runId.equals(run.runId()) && orderUuid.equals(order);
        }
    }

    static Path localPath(String raw) {
        if (raw == null || raw.isBlank()) throw new IllegalArgumentException("Missing F521 marker path");
        Path path = Path.of(raw);
        if (!path.isAbsolute() || !path.equals(path.normalize())) throw new IllegalArgumentException("F521 paths must be absolute and normalized");
        for (Path part : path) {
            String name = part.toString().toLowerCase(Locale.ROOT);
            if (name.contains("cloudstorage") || name.contains("mobile documents") || name.contains("onedrive")) {
                throw new IllegalArgumentException("F521 paths must be local");
            }
        }
        Path cursor = path.getRoot();
        for (Path part : path) {
            cursor = cursor.resolve(part);
            if (Files.isSymbolicLink(cursor)) throw new IllegalArgumentException("F521 paths cannot traverse symbolic links");
        }
        return path;
    }

    static Control control() {
        String file = System.getenv("GCSP_F521_CONTROL_FILE");
        if (file == null || file.isBlank()) return HTTP_CONTROL.get();
        Path path = localPath(file);
        try {
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > 4096) {
                throw new IllegalStateException("F521 control must be a small local regular file");
            }
            JsonNode value = JSON.readTree(Files.readString(path));
            for (String key : List.of("environmentId", "runId", "orderUuid")) {
                if (!value.path(key).isTextual() || value.path(key).asText().isBlank()) {
                    throw new IllegalStateException("Invalid F521 control scope");
                }
            }
            for (String key : List.of("offerUnavailable", "writePending")) {
                if (value.has(key) && !value.path(key).isBoolean()) throw new IllegalStateException("Invalid F521 control flag");
            }
            return new Control(value.path("environmentId").asText(), value.path("runId").asText(),
                    value.path("orderUuid").asText(), value.path("offerUnavailable").asBoolean(), value.path("writePending").asBoolean());
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read F521 control", e);
        }
    }

    static final class ControlledAppointmentProvider implements AppointmentProvider {
        private final AppointmentProvider delegate;
        final AtomicReference<Scope> observed = new AtomicReference<>();

        ControlledAppointmentProvider(AppointmentProvider delegate) {
            this.delegate = delegate;
        }

        @Override
        public String mode() {
            return delegate.mode();
        }

        @Override
        public SlotOffer offerSlots(Instant now, SlotPolicy policy) {
            Scope scope = observed.get();
            Control c = control();
            if (scope != null && c != null && c.matches(scope.run(), scope.orderUuid()) && c.offerUnavailable()) {
                return new SlotOffer.Unavailable();
            }
            return delegate.offerSlots(now, policy);
        }

        @Override
        public ProviderAnswer write(ProviderOperation operation, Instant now) {
            return pending(operation) ? new ProviderAnswer.Unknown() : delegate.write(operation, now);
        }

        @Override
        public ProviderAnswer reconcile(ProviderOperation operation) {
            return pending(operation) ? new ProviderAnswer.Unknown() : delegate.reconcile(operation);
        }

        private boolean pending(ProviderOperation operation) {
            Control c = control();
            return c != null && c.matches(operation.context(), operation.orderUuid()) && c.writePending();
        }
    }
}
