package gcsp.api.notify;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.Map;

/** An employee whose employees row the tests seed, so the notification email is theirs alone. */
public class NotifyEmployeeProfile implements QuarkusTestProfile {

    static final String TOKEN = "notify-employee-token";
    static final String EMPLOYEE_ID = "E-1001";

    @Override
    public Map<String, String> getConfigOverrides() {
        return NotifyProfiles.of(TOKEN, "employee", EMPLOYEE_ID, "account:read");
    }
}
