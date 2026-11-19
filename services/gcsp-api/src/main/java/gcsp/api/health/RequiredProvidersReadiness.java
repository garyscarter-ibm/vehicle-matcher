package gcsp.api.health;

import gcsp.api.persistence.Persistence;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.HealthCheckResponseBuilder;
import org.eclipse.microprofile.health.Readiness;

/**
 * Not ready while a provider the deployment requires is none/unset or persistence is off (GCSP_REQUIRED_PROVIDERS).
 * Unknown keys stop startup; an empty list is always ready.
 */
@Readiness
@ApplicationScoped
@Startup
public class RequiredProvidersReadiness implements HealthCheck {

    static final String PERSISTENCE = "persistence";
    static final Map<String, String> KEYS = keys();

    @ConfigProperty(name = "gcsp.readiness.required-providers")
    Optional<String> configured;

    @Inject
    Config config;

    @Inject
    Persistence persistence;

    private List<String> required = List.of();

    @PostConstruct
    void init() {
        required = parse(configured.orElse(""));
        validate(required);
    }

    @Override
    public HealthCheckResponse call() {
        return evaluate(name -> config.getOptionalValue(name, String.class).orElse(null), persistence.active(),
                required);
    }

    public static HealthCheckResponse evaluate(Function<String, String> lookup, boolean persistenceActive,
            List<String> required) {
        List<String> unconfigured = new ArrayList<>();
        for (String key : required) {
            validate(List.of(key));
            boolean ok = PERSISTENCE.equals(key) ? persistenceActive : !isNone(lookup.apply(KEYS.get(key)));
            if (!ok) unconfigured.add(key);
        }
        HealthCheckResponseBuilder b = HealthCheckResponse.named("required-providers")
                .withData("required", String.join(",", required));
        if (!unconfigured.isEmpty()) b.withData("unconfigured", String.join(",", unconfigured));
        return b.status(unconfigured.isEmpty()).build();
    }

    static void validate(List<String> required) {
        for (String key : required) {
            if (!PERSISTENCE.equals(key) && !KEYS.containsKey(key)) {
                throw new IllegalStateException("Unknown required provider '" + key
                        + "' in gcsp.readiness.required-providers; supported: " + supported());
            }
        }
    }

    public static List<String> parse(String value) {
        List<String> out = new ArrayList<>();
        if (value == null) return out;
        for (String key : value.split("[,\\s]+")) {
            String k = key.trim().toLowerCase(Locale.ROOT);
            if (!k.isEmpty() && !out.contains(k)) out.add(k);
        }
        return out;
    }

    private static boolean isNone(String value) {
        return value == null || value.isBlank() || "none".equalsIgnoreCase(value.trim());
    }

    private static String supported() {
        List<String> all = new ArrayList<>(KEYS.keySet());
        all.add(PERSISTENCE);
        return String.join(", ", all);
    }

    private static Map<String, String> keys() {
        Map<String, String> m = new LinkedHashMap<>();
        for (String k : List.of("identity", "account", "scenario", "supply", "ordering", "approvals", "documents",
                "appointments", "returns", "production", "evidence")) {
            m.put(k, "gcsp." + k + ".provider");
        }
        m.put("allocation-candidates", "gcsp.allocation.candidates.provider");
        return Collections.unmodifiableMap(m);
    }
}
