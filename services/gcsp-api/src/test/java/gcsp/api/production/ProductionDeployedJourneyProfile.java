package gcsp.api.production;

import gcsp.api.JwksServerResource;
import gcsp.api.account.ClaimCompositionSeed;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The dev composition for the Production deployed journey: no test alternative, native PostgreSQL, a private schema. */
public final class ProductionDeployedJourneyProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    /** One name per JVM: a class constant would differ between Quarkus class loaders. */
    static final String SCHEMA = String.valueOf(System.getProperties().computeIfAbsent("gcsp.test.proddeployed.schema",
            k -> "gcsp_s_proddep_" + Long.toHexString(System.nanoTime())));
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-alex\",\"roles\":[\"employee\"],\"employeeId\":\"employee-alex\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    static String databaseName(String url) {
        String path = url.substring(url.lastIndexOf('/') + 1);
        int q = path.indexOf('?');
        return q < 0 ? path : path.substring(0, q);
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = ClaimCompositionSeed.config(SCHEMA);
        // No fixed account clock: the claim, ordering and account clocks are wall time, the run clock is the presenter's.
        c.remove("gcsp.account.fixed-now");
        if (URL != null && !URL.isBlank()) c.put("gcsp.database.expected-name", databaseName(URL));
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.production.provider", "synthetic");
        c.put("gcsp.supply.provider", "demo");
        // Global @Priority alternatives from other suites must not replace the real beans this journey proves.
        c.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records,"
                + "gcsp.api.documents.DocumentsTestPorts$Policy,gcsp.api.documents.DocumentsTestPorts$Cases,"
                + "gcsp.api.documents.DocumentsTestPorts$Clock");
        return c;
    }

    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of();
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }
}
