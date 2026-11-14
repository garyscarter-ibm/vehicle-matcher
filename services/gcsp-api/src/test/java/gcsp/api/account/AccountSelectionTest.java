package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.runtime.LaunchMode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Startup rules: nothing synthetic or half configured can be selected silently. */
class AccountSelectionTest {

    @TempDir
    Path tmp;

    @Test
    void defaultIsNoneAndEveryReadRefuses() {
        AccountRecordsPort port = AccountSelection.records(null, null);
        assertInstanceOf(UnconfiguredAccountRecords.class, port);
        assertEquals("account-provider-not-configured", port.readEmployment("e", "r", "x").code());
    }

    @Test
    void unknownProviderStopsStartupAndListsSupportedValues() {
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> AccountSelection.records("ldap", null));
        assertTrue(e.getMessage().contains("none") && e.getMessage().contains("hr-snapshot"), e.getMessage());
    }

    @Test
    void hrSnapshotNeedsAUsablePath() throws IOException {
        assertThrows(IllegalStateException.class, () -> AccountSelection.records("hr-snapshot", null));
        assertThrows(IllegalStateException.class, () -> AccountSelection.records("hr-snapshot", " "));
        assertThrows(IllegalStateException.class,
                () -> AccountSelection.records("hr-snapshot", tmp.resolve("missing.json").toString()));
        Path bad = Files.writeString(tmp.resolve("bad.json"), "not json");
        assertThrows(IllegalStateException.class, () -> AccountSelection.records("hr-snapshot", bad.toString()));
        Path wrong = Files.writeString(tmp.resolve("wrong.json"), "{\"schema\":\"other/1\",\"people\":[]}");
        assertThrows(IllegalStateException.class, () -> AccountSelection.records("hr-snapshot", wrong.toString()));
    }

    @Test
    void fixedNowIsHonouredOnlyInTestLaunchMode() {
        String now = "2026-11-05T09:00:00.000Z";
        assertThrows(IllegalStateException.class, () -> AccountSelection.clock(now, LaunchMode.NORMAL));
        assertThrows(IllegalStateException.class, () -> AccountSelection.clock(now, LaunchMode.DEVELOPMENT));
        assertEquals(now, AccountSelection.clock(now, LaunchMode.TEST).now(null).now());
        assertThrows(IllegalStateException.class, () -> AccountSelection.clock("yesterday", LaunchMode.TEST));
        assertInstanceOf(SystemAccountClock.class, AccountSelection.clock(null, LaunchMode.NORMAL));
    }
}
