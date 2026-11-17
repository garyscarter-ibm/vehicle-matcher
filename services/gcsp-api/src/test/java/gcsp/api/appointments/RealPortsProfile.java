package gcsp.api.appointments;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The identity and database of the appointment HTTP profiles, with every test port alternative left out. */
public class RealPortsProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = new HashMap<>(new ApptHttpProfiles.Synthetic().getConfigOverrides());
        for (String area : List.of("approvals", "documents", "ordering")) m.put("gcsp." + area + ".provider", "synthetic");
        // DocumentsTestPorts declares globally enabled @Priority alternatives; the real beans must win here.
        m.put("quarkus.arc.exclude-types", "gcsp.api.documents.DocumentsTestPorts$Policy,"
                + "gcsp.api.documents.DocumentsTestPorts$Cases,gcsp.api.documents.DocumentsTestPorts$Clock");
        return m;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }
}
