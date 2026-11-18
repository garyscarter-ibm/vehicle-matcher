package gcsp.api.learning;

import gcsp.api.JwksServerResource;
import gcsp.api.account.ClaimCompositionSeed;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The order-plan journey composition (no test alternative, native PostgreSQL, a private schema), with and without a model. */
public final class LearnedPlanProfiles {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String MODEL = "sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d";
    static final String BASE = "gcsp-policy-v1";
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-alex\",\"roles\":[\"employee\"],\"employeeId\":\"employee-alex\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private LearnedPlanProfiles() {
    }

    static Map<String, String> config(String schema) {
        Map<String, String> c = ClaimCompositionSeed.config(schema);
        // No fixed account clock: the run clock is the presenter's.
        c.remove("gcsp.account.fixed-now");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.production.provider", "synthetic");
        c.put("gcsp.supply.provider", "demo");
        c.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records,"
                + "gcsp.api.documents.DocumentsTestPorts$Policy,gcsp.api.documents.DocumentsTestPorts$Cases,"
                + "gcsp.api.documents.DocumentsTestPorts$Clock");
        return c;
    }

    /** One name per JVM: a class constant would differ between Quarkus class loaders. */
    private static String once(String key, String prefix) {
        return String.valueOf(System.getProperties().computeIfAbsent(key, k -> prefix + Long.toHexString(System.nanoTime())));
    }

    /** The started app with the retained model activated through the configured +learned-model-v1 version. */
    public static final class Learned implements QuarkusTestProfile {
        static final String SCHEMA_PREFIX = "gcsp_s_learnj_";
        static final String VERSION = BASE + "+learned-model-v1";

        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = config(once("gcsp.test.learnj.schema", SCHEMA_PREFIX));
            c.put("gcsp.environment.policy-version", VERSION);
            c.put("gcsp.learning.active-model", MODEL);
            c.put("gcsp.learning.artifact-dir", artifactDir());
            return c;
        }

        /** A private copy of the retained artifact, so the test can remove and corrupt it on the started app. */
        private static String artifactDir() {
            String key = "gcsp.test.learnj.artifact-dir";
            Object known = System.getProperties().get(key);
            if (known != null) return known.toString();
            try {
                Path dir = Files.createTempDirectory("gcsp-learnj-");
                String name = MODEL.substring(7) + ".json";
                try (var in = LearnedPlanProfiles.class.getClassLoader().getResourceAsStream("gcsp/learning/artifacts/" + name)) {
                    if (in == null) throw new IllegalStateException("the retained artifact is not on the classpath");
                    Files.copy(in, dir.resolve(name));
                }
                System.getProperties().put(key, dir.toString());
                return dir.toString();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
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

    /** The same composition with no model settings: the default, where the learned section falls back. */
    public static final class Default implements QuarkusTestProfile {
        static final String SCHEMA_PREFIX = "gcsp_s_learnd_";

        @Override
        public Map<String, String> getConfigOverrides() {
            return config(once("gcsp.test.learnd.schema", SCHEMA_PREFIX));
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
}
