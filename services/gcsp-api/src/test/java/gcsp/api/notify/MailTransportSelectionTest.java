package gcsp.api.notify;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class MailTransportSelectionTest {

    @Test
    void unsetOrBlankKeepsMailCaptured() {
        assertInstanceOf(CapturedTransport.class, MailTransportSelection.select(Optional.empty()));
        assertInstanceOf(CapturedTransport.class, MailTransportSelection.select(Optional.of("")));
        assertInstanceOf(CapturedTransport.class, MailTransportSelection.select(Optional.of("   ")));
        assertEquals("captured", MailTransportSelection.select(Optional.empty()).name());
    }

    @Test
    void anUnknownTransportStopsStartup() {
        IllegalStateException refused = assertThrows(IllegalStateException.class,
                () -> MailTransportSelection.select(Optional.of("nonsense")));
        assertTrue(refused.getMessage().startsWith("Unknown mail transport"));
    }

    static final String KEY = "test-key-not-secret-0123456789";
    static final String ENDPOINT = "https://api.brevo.com/v3/smtp/email";
    static final Duration TEN = Duration.ofSeconds(10);

    static BrevoSettings brevo(String key, String from, String name, String base, String endpoint, Duration timeout,
            boolean loopback) {
        return MailTransportSelection.brevoSettings(key, from, name, base, endpoint, timeout, loopback);
    }

    static BrevoSettings valid() {
        return brevo(KEY, "from@example.test", "Demo", "https://demo.example/", ENDPOINT, TEN, false);
    }

    @Test
    void validBrevoSettingsBuildAndHideTheKey() {
        BrevoSettings s = valid();
        assertEquals("https://demo.example/", s.publicBase().toString());
        assertFalse(s.toString().contains(KEY));
    }

    @Test
    void eachMissingOrInvalidBrevoSettingStopsStartupWithoutTheKey() {
        String[][] bad = {
            {"", "from@example.test", "Demo", "https://demo.example/", "GCSP_BREVO_API_KEY"},
            {"key with space", "from@example.test", "Demo", "https://demo.example/", "GCSP_BREVO_API_KEY"},
            {KEY + "\n", "from@example.test", "Demo", "https://demo.example/", "GCSP_BREVO_API_KEY"},
            {KEY, "", "Demo", "https://demo.example/", "GCSP_MAIL_FROM"},
            {KEY, "not-an-email", "Demo", "https://demo.example/", "GCSP_MAIL_FROM"},
            {KEY, "from@example.test", "", "https://demo.example/", "GCSP_MAIL_FROM_NAME"},
            {KEY, "from@example.test", "De\nmo", "https://demo.example/", "GCSP_MAIL_FROM_NAME"},
            {KEY, "from@example.test", "Demo", "", "GCSP_PUBLIC_BASE_URL"},
            {KEY, "from@example.test", "Demo", "http://demo.example/", "GCSP_PUBLIC_BASE_URL"}};
        for (String[] b : bad) {
            IllegalStateException e = assertThrows(IllegalStateException.class,
                    () -> brevo(b[0], b[1], b[2], b[3], ENDPOINT, TEN, false));
            assertTrue(e.getMessage().contains(b[4]), e.getMessage());
            assertFalse(e.getMessage().contains(KEY));
        }
    }

    @Test
    void endpointAndTimeoutAreChecked() {
        String base = "https://demo.example/";
        for (String endpoint : new String[] {"http://api.example.test/v3", "http://127.0.0.1:8080/x", "ftp://x.test/", "",
            "https://user@api.example.test/"}) {
            assertThrows(IllegalStateException.class, () -> brevo(KEY, "f@example.test", "D", base, endpoint, TEN, false), endpoint);
        }
        assertThrows(IllegalStateException.class,
                () -> brevo(KEY, "f@example.test", "D", base, "http://api.example.test/v3", TEN, true));
        assertEquals("http://127.0.0.1:8080/x",
                brevo(KEY, "f@example.test", "D", base, "http://127.0.0.1:8080/x", TEN, true).endpoint().toString());
        for (Duration t : new Duration[] {Duration.ZERO, Duration.ofSeconds(-1), Duration.ofSeconds(61)}) {
            assertThrows(IllegalStateException.class, () -> brevo(KEY, "f@example.test", "D", base, ENDPOINT, t, false));
        }
        assertEquals(Duration.ofSeconds(60), brevo(KEY, "f@example.test", "D", base, ENDPOINT, Duration.ofSeconds(60), false).timeout());
    }

    @Test
    void brevoSelectionBuildsAConfiguredTransportOnce() throws Exception {
        try (NotifyFixture f = NotifyFixture.create()) {
            MailTransport t = new BrevoTransport(f.pool(), valid(), java.time.InstantSource.system(),
                    BrevoTransport.newClient(TEN));
            assertEquals("configured", t.name());
        }
    }
}
