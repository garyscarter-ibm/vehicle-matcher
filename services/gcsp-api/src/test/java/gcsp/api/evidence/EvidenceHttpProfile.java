package gcsp.api.evidence;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/** Fixed-test employee over the retained stores, read in place; subclasses pick the provider and store. */
public class EvidenceHttpProfile implements QuarkusTestProfile {

    static final String TOKEN = "evidence-employee-token";
    static final Path MODULE = Path.of("").toAbsolutePath();
    static final Path REAL = MODULE.resolve("../../server/data/gcsp/vehicle-evidence").normalize();
    static final Path REPO = MODULE.resolve("../..").normalize();

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "fixed-test");
        m.put("gcsp.identity.fixed-test.token", TOKEN);
        m.put("gcsp.identity.fixed-test.subject", "evidence-reader");
        m.put("gcsp.identity.fixed-test.roles", "employee");
        m.put("gcsp.identity.fixed-test.environment-id", "consumer-test");
        m.put("gcsp.identity.fixed-test.run-id", "consumer-run");
        m.put("gcsp.identity.fixed-test.policy-version", "retained-version");
        m.put("gcsp.identity.fixed-test.capabilities", "account:read");
        m.put("gcsp.evidence.provider", provider());
        if (!"none".equals(provider())) {
            m.put("gcsp.evidence.store", store().toString());
            m.put("gcsp.evidence.reference-dir", REAL.toString());
            m.put("gcsp.evidence.assets-root", REPO.toString());
        }
        if ("alternate-offline".equals(provider())) m.put("gcsp.evidence.alternate-file", ProviderCases.ALTERNATE.toString());
        m.put("gcsp.evidence.images-public", Boolean.toString(imagesPublic()));
        return m;
    }

    String provider() {
        return "lookup";
    }

    Path store() {
        return REAL.resolve("lookup-reference.v1");
    }

    boolean imagesPublic() {
        return false;
    }

    /** The same requests answered from the offline-cards shape. */
    public static class Alternate extends EvidenceHttpProfile {
        @Override
        String provider() {
            return "alternate-offline";
        }
    }

    /** No provider configured: every read is source-unavailable. */
    public static class None extends EvidenceHttpProfile {
        @Override
        String provider() {
            return "none";
        }
    }

    /** A store whose manifest checksums fail: reported unavailable, startup continues. */
    public static class Corrupt extends EvidenceHttpProfile {
        @Override
        Path store() {
            return MODULE.resolve("src/test/resources/evidence/stores/checksum-corrupt");
        }
    }

    /** The retained fleet store with its images; the images are served without a bearer token only when public. */
    public static class Fleet extends EvidenceHttpProfile {
        @Override
        Path store() {
            return REAL.resolve("fleet-source.v1");
        }
    }

    public static class FleetPublicImages extends Fleet {
        @Override
        boolean imagesPublic() {
            return true;
        }
    }
}
