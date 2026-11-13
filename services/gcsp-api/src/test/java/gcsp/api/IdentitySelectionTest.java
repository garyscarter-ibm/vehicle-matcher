package gcsp.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;

import gcsp.api.identity.IdentityResult;
import gcsp.api.identity.IdentitySelection;
import io.quarkus.runtime.LaunchMode;
import org.junit.jupiter.api.Test;

/** The selection rule that keeps synthetic identity out of every non-test launch. */
class IdentitySelectionTest {

    @Test
    void defaultIsNoneAndRefusesEveryToken() {
        var port = IdentitySelection.select(null, LaunchMode.NORMAL, null);
        assertEquals("none", port.mode());
        assertInstanceOf(IdentityResult.Unavailable.class, port.resolve("anything"));
    }

    @Test
    void fixedTestIsRefusedInProductionAndDevLaunches() {
        assertThrows(IllegalStateException.class,
                () -> IdentitySelection.select("fixed-test", LaunchMode.NORMAL, null));
        assertThrows(IllegalStateException.class,
                () -> IdentitySelection.select("fixed-test", LaunchMode.DEVELOPMENT, null));
    }

    @Test
    void unknownProviderStopsStartup() {
        assertThrows(IllegalStateException.class, () -> IdentitySelection.select("ldap", LaunchMode.NORMAL, null));
    }

    @Test
    void oidcWithoutConfigStopsStartup() {
        assertThrows(IllegalStateException.class, () -> IdentitySelection.select("oidc", LaunchMode.NORMAL, null));
        assertThrows(IllegalStateException.class, () -> IdentitySelection.select("oidc", LaunchMode.TEST, null));
    }
}
