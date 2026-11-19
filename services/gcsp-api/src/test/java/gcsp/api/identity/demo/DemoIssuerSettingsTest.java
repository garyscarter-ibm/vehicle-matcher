package gcsp.api.identity.demo;

import static gcsp.api.identity.demo.DemoSupport.PEOPLE;
import static gcsp.api.identity.demo.DemoSupport.lookup;
import static gcsp.api.identity.demo.DemoSupport.valid;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.runtime.LaunchMode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;

/** Off by default, and every wrong composition or value refuses with a message naming the key. */
class DemoIssuerSettingsTest {

    private static Optional<DemoIssuerSettings> build(Map<String, String> m, LaunchMode mode, boolean persistence) {
        return DemoIssuerSettings.fromLookup(lookup(m), mode, persistence, () -> PEOPLE);
    }

    private static String refusal(Map<String, String> m) {
        return assertThrows(IllegalStateException.class, () -> build(m, LaunchMode.NORMAL, true)).getMessage();
    }

    private static Map<String, String> with(String key, String value) {
        Map<String, String> m = valid();
        m.put(key, value);
        return m;
    }

    private static void refuses(String key, String value, String expected) {
        String message = refusal(with(key, value));
        assertTrue(message.contains(expected), message);
    }

    @Test
    void validConfigurationGivesTheSettings() {
        DemoIssuerSettings s = build(valid(), LaunchMode.NORMAL, true).orElseThrow();
        assertEquals(DemoSupport.ISSUER, s.issuer());
        assertEquals("gcsp-web", s.clientId());
        assertEquals("openid profile gcsp-api", s.scope());
        assertEquals("realm_access.roles", s.roleClaim());
        assertEquals(Duration.ofMinutes(10), s.accessTokenLifetime());
        assertEquals(Duration.ofHours(12), s.refreshTokenLifetime());
        assertEquals(DemoSupport.ISSUER + "/token", s.endpoint("/token"));
    }

    @Test
    void offByDefaultWhateverElseIsMissing() {
        AtomicBoolean peopleRead = new AtomicBoolean();
        assertTrue(DemoIssuerSettings.fromLookup(k -> Optional.empty(), LaunchMode.NORMAL, false,
                () -> { peopleRead.set(true); return PEOPLE; }).isEmpty());
        assertFalse(peopleRead.get());
        for (String off : new String[] {"", "  ", "false", "FALSE"}) {
            assertTrue(build(with("gcsp.demo-idp.enabled", off), LaunchMode.NORMAL, true).isEmpty(), off);
            Map<String, String> bare = new HashMap<>();
            bare.put("gcsp.demo-idp.enabled", off);
            assertTrue(build(bare, LaunchMode.NORMAL, false).isEmpty(), off);
        }
    }

    @Test
    void refusesAnythingButTrueOrFalse() {
        refuses("gcsp.demo-idp.enabled", "yes", "gcsp.demo-idp.enabled");
        refuses("gcsp.demo-idp.enabled", "1", "gcsp.demo-idp.enabled");
    }

    @Test
    void refusesWithoutOidcIdentity() {
        for (String provider : new String[] {"none", "fixed-test", "", "other"}) {
            refuses("gcsp.identity.provider", provider, "gcsp.demo-idp.enabled=true needs gcsp.identity.provider=oidc");
        }
    }

    @Test
    void refusesWithoutTheDemoScenarioProvider() {
        for (String provider : new String[] {"none", "", "live"}) {
            refuses("gcsp.scenario.provider", provider, "gcsp.scenario.provider=demo");
        }
    }

    @Test
    void refusesWithoutPersistence() {
        String message = assertThrows(IllegalStateException.class,
                () -> build(valid(), LaunchMode.NORMAL, false)).getMessage();
        assertTrue(message.contains("database"), message);
    }

    @Test
    void refusesABadIssuer() {
        refuses("gcsp.oidc.issuer", "", "gcsp.oidc.issuer");
        refuses("gcsp.oidc.issuer", "http://demo.example.test/demo-idp", "gcsp.oidc.issuer");
        refuses("gcsp.oidc.issuer", "http://127.0.0.1:8080/demo-idp", "gcsp.oidc.issuer");
        refuses("gcsp.oidc.issuer", "https://demo.example.test", "/demo-idp");
        refuses("gcsp.oidc.issuer", "https://demo.example.test/realms/gcsp", "/demo-idp");
        refuses("gcsp.oidc.issuer", "https://demo.example.test/demo-idp/", "/demo-idp");
        refuses("gcsp.oidc.issuer", "https://demo.example.test/demo-idp?x=1", "gcsp.oidc.issuer");
    }

    @Test
    void allowsHttpLoopbackOnlyInAutomatedTests() {
        Map<String, String> m = valid();
        m.put("gcsp.oidc.issuer", "http://127.0.0.1:8080/demo-idp");
        m.put("gcsp.oidc.jwks-uri", "http://127.0.0.1:8080/demo-idp/jwks");
        m.put("gcsp.demo-idp.redirect-uris", "http://localhost:4200/gcsp/auth/callback");
        assertTrue(build(m, LaunchMode.TEST, true).isPresent());
        assertThrows(IllegalStateException.class, () -> build(m, LaunchMode.NORMAL, true));
    }

    @Test
    void refusesAJwksAddressThatIsNotTheIssuersOwn() {
        refuses("gcsp.oidc.jwks-uri", "", "gcsp.oidc.jwks-uri");
        refuses("gcsp.oidc.jwks-uri", "https://elsewhere.example.test/jwks", "gcsp.oidc.jwks-uri");
        refuses("gcsp.oidc.jwks-uri", DemoSupport.ISSUER + "/certs", "gcsp.oidc.jwks-uri");
    }

    @Test
    void refusesBlankClientOrAudience() {
        refuses("gcsp.oidc.authorized-party", "", "gcsp.oidc.authorized-party");
        refuses("gcsp.oidc.audience", "  ", "gcsp.oidc.audience");
    }

    @Test
    void refusesMissingOrBadRedirectLists() {
        for (String key : new String[] {"gcsp.demo-idp.redirect-uris", "gcsp.demo-idp.post-logout-redirect-uris"}) {
            refuses(key, "", key);
            refuses(key, "  ", key);
            refuses(key, "/relative/path", key);
            refuses(key, "http://web.example.test/cb", key);
            refuses(key, "https://web.example.test/cb#frag", key);
            refuses(key, "https://web.example.test/ok, http://web.example.test/bad", key);
            refuses(key, "myapp://callback", key);
        }
    }

    @Test
    void acceptsSeveralRedirectsSeparatedByCommaOrSpace() {
        DemoIssuerSettings s = build(with("gcsp.demo-idp.redirect-uris",
                "https://a.example.test/cb, https://b.example.test/cb https://c.example.test/cb"),
                LaunchMode.NORMAL, true).orElseThrow();
        assertEquals(3, s.redirectUris().size());
    }

    @Test
    void refusesBadLifetimes() {
        refuses("gcsp.demo-idp.access-token-lifetime", "soon", "gcsp.demo-idp.access-token-lifetime");
        refuses("gcsp.demo-idp.access-token-lifetime", "0s", "gcsp.demo-idp.access-token-lifetime");
        refuses("gcsp.demo-idp.access-token-lifetime", "25h", "gcsp.demo-idp.access-token-lifetime");
        refuses("gcsp.demo-idp.refresh-token-lifetime", "-1h", "gcsp.demo-idp.refresh-token-lifetime");
    }

    @Test
    void refusesAccountsThatDoNotMatchTheDemoPeople() {
        refuses("gcsp.oidc.accounts", "", "gcsp.oidc.accounts");
        for (DemoPerson p : PEOPLE) {
            List<DemoPerson> others = new ArrayList<>(PEOPLE);
            others.remove(p);
            String message = refusal(with("gcsp.oidc.accounts", DemoSupport.accountsJson(others)));
            assertTrue(message.contains("gcsp.oidc.accounts") && message.contains(p.principalId()), message);
        }
        DemoPerson paula = PEOPLE.stream().filter(p -> p.principalId().equals("demo-paula")).findFirst().orElseThrow();
        DemoPerson changedRoles = new DemoPerson(paula.principalId(), paula.employeeId(), paula.name(),
                List.of("greg", "employee"));
        refuses("gcsp.oidc.accounts", DemoSupport.accountsJson(replace(paula, changedRoles)), "gcsp.oidc.accounts");
        DemoPerson otherEmployee = new DemoPerson(paula.principalId(), "employee-someone-else", paula.name(),
                paula.roles());
        refuses("gcsp.oidc.accounts", DemoSupport.accountsJson(replace(paula, otherEmployee)), "employeeId");
    }

    private static List<DemoPerson> replace(DemoPerson from, DemoPerson to) {
        List<DemoPerson> out = new ArrayList<>(PEOPLE);
        out.set(out.indexOf(from), to);
        return out;
    }
}
