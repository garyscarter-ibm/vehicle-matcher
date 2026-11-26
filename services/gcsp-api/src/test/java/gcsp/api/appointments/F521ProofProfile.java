package gcsp.api.appointments;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** Uses the connected composition's real demo identity, stage adapters, database and TLS configuration. */
public class F521ProofProfile implements QuarkusTestProfile {
    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of(F521AppointmentsWiring.class);
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> config = new HashMap<>();
        // The connected proof must read its actual PostgreSQL offers, not the global HTTP fixture's empty map.
        config.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records");
        String port = System.getenv("GCSP_F521_API_PORT");
        if (port != null) config.put("quarkus.http.test-ssl-port", port);
        String origins = System.getenv("GCSP_ALLOWED_ORIGINS");
        if (origins != null) config.put("quarkus.http.cors.origins", origins);
        return config;
    }
}
