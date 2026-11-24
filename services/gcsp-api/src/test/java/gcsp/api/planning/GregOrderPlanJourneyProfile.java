package gcsp.api.planning;

import gcsp.api.JwksServerResource;
import gcsp.api.account.ClaimCompositionSeed;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The documented dev composition for the order-plan journey: no test alternative, native PostgreSQL, a private schema. */
public final class GregOrderPlanJourneyProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    /** One name per JVM: a class constant would differ between Quarkus class loaders. */
    static final String SCHEMA = String.valueOf(System.getProperties().computeIfAbsent("gcsp.test.planjourney.schema",
            k -> "gcsp_s_planj_" + Long.toHexString(System.nanoTime())));
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-alex\",\"roles\":[\"employee\"],\"employeeId\":\"employee-alex\"},"
            + "{\"subject\":\"sub-jordan\",\"roles\":[\"employee\"],\"employeeId\":\"employee-jordan\"},"
            + "{\"subject\":\"sub-sam\",\"roles\":[\"employee\"],\"employeeId\":\"employee-sam\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = ClaimCompositionSeed.config(SCHEMA);
        // No fixed account clock: real account, claim, ordering and planning bindings observe the scoped presenter run.
        c.remove("gcsp.account.fixed-now");
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
