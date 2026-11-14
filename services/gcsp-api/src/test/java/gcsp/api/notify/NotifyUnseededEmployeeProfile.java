package gcsp.api.notify;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.Map;

/** An employee id that no test seeds, so the employee has no record in the run. */
public class NotifyUnseededEmployeeProfile implements QuarkusTestProfile {

    static final String TOKEN = "notify-unseeded-token";
    static final String EMPLOYEE_ID = "E-1404";

    @Override
    public Map<String, String> getConfigOverrides() {
        return NotifyProfiles.of(TOKEN, "employee", EMPLOYEE_ID, "account:read");
    }
}
