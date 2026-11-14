package gcsp.api.notify;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.Map;

/** A presenter with no employee record: the outbox and the drain run; the employee endpoint refuses. */
public class NotifyPresenterProfile implements QuarkusTestProfile {

    static final String TOKEN = "notify-presenter-token";

    @Override
    public Map<String, String> getConfigOverrides() {
        return NotifyProfiles.of(TOKEN, "presenter", null, "presenter:control,presenter:inspect");
    }
}
