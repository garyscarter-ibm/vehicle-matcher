package gcsp.api.identity.demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.health.RequiredProvidersReadiness;
import gcsp.api.identity.IdentityPort;
import gcsp.api.identity.IdentitySelection;
import gcsp.api.identity.OidcIdentity;
import gcsp.api.identity.UnconfiguredIdentity;
import gcsp.api.scenario.DemoPreparationFile;
import io.quarkus.runtime.LaunchMode;
import io.smallrye.config.PropertiesConfigSource;
import io.smallrye.config.SmallRyeConfigBuilder;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.junit.jupiter.api.Test;

/** Each committed Render Blueprint, read as the API would see it, starts the demo issuer and leaves readiness UP. */
class DemoBlueprintCompositionTest {

    private static final Map<String, String> PROPERTIES = Map.ofEntries(
            Map.entry("GCSP_IDENTITY_PROVIDER", "gcsp.identity.provider"),
            Map.entry("GCSP_DEMO_IDP_ENABLED", "gcsp.demo-idp.enabled"),
            Map.entry("GCSP_DEMO_IDP_REDIRECT_URIS", "gcsp.demo-idp.redirect-uris"),
            Map.entry("GCSP_DEMO_IDP_POST_LOGOUT_REDIRECT_URIS", "gcsp.demo-idp.post-logout-redirect-uris"),
            Map.entry("GCSP_OIDC_ISSUER", "gcsp.oidc.issuer"),
            Map.entry("GCSP_OIDC_JWKS_URI", "gcsp.oidc.jwks-uri"),
            Map.entry("GCSP_OIDC_AUDIENCE", "gcsp.oidc.audience"),
            Map.entry("GCSP_OIDC_AUTHORIZED_PARTY", "gcsp.oidc.authorized-party"),
            Map.entry("GCSP_OIDC_REQUIRED_SCOPES", "gcsp.oidc.required-scopes"),
            Map.entry("GCSP_OIDC_ROLE_CLAIM", "gcsp.oidc.role-claim"),
            Map.entry("GCSP_OIDC_ACCOUNTS", "gcsp.oidc.accounts"),
            Map.entry("GCSP_ENVIRONMENT_ID", "gcsp.environment.id"),
            Map.entry("GCSP_RUN_ID", "gcsp.environment.run-id"),
            Map.entry("GCSP_POLICY_VERSION", "gcsp.environment.policy-version"),
            Map.entry("GCSP_SCENARIO_PROVIDER", "gcsp.scenario.provider"),
            Map.entry("GCSP_SUPPLY_PROVIDER", "gcsp.supply.provider"),
            Map.entry("GCSP_ACCOUNT_PROVIDER", "gcsp.account.provider"),
            Map.entry("GCSP_ALLOCATION_CANDIDATES_PROVIDER", "gcsp.allocation.candidates.provider"),
            Map.entry("GCSP_ORDERING_PROVIDER", "gcsp.ordering.provider"),
            Map.entry("GCSP_APPROVALS_PROVIDER", "gcsp.approvals.provider"),
            Map.entry("GCSP_DOCUMENTS_PROVIDER", "gcsp.documents.provider"),
            Map.entry("GCSP_APPOINTMENTS_PROVIDER", "gcsp.appointments.provider"),
            Map.entry("GCSP_RETURNS_PROVIDER", "gcsp.returns.provider"),
            Map.entry("GCSP_PRODUCTION_PROVIDER", "gcsp.production.provider"),
            Map.entry("GCSP_VEHICLE_EVIDENCE_PROVIDER", "gcsp.evidence.provider"));

    private static final Pattern KEY = Pattern.compile("^      - key: (\\S+)\\s*(#.*)?$");
    private static final Pattern VALUE = Pattern.compile("^        value: (.*)$");
    private static final Pattern SYNC_FALSE = Pattern.compile("^        sync: false\\b.*$");

    @Test
    void devBlueprintStartsTheDemoIssuerAndIsReady() throws IOException {
        check("render.gcsp-buddy-dev.yaml", "gcsp-buddy-dev-api");
    }

    @Test
    void mainBlueprintStartsTheDemoIssuerAndIsReady() throws IOException {
        check("render.gcsp-buddy.yaml", "gcsp-buddy-api");
    }

    private static void check(String file, String service) throws IOException {
        Map<String, String> env = apiEnv(Path.of("../../" + file), service);
        Map<String, String> props = new LinkedHashMap<>();
        // The Blueprint leaves lifetimes alone, so application.properties supplies these defaults.
        props.put("gcsp.demo-idp.access-token-lifetime", "10m");
        props.put("gcsp.demo-idp.refresh-token-lifetime", "12h");
        for (Map.Entry<String, String> e : env.entrySet()) {
            String property = PROPERTIES.get(e.getKey());
            if (property != null) props.put(property, e.getValue() == null ? "placeholder-" + e.getKey() : e.getValue());
        }
        Function<String, Optional<String>> lookup = k -> Optional.ofNullable(props.get(k));

        assertTrue(DemoIssuerSettings.fromLookup(lookup, LaunchMode.NORMAL, true,
                () -> DemoPerson.from(DemoPreparationFile.load())).isPresent(), file);
        assertEquals("oidc", OidcIdentity.fromLookup(lookup, LaunchMode.NORMAL).mode(), file);
        Config config = new SmallRyeConfigBuilder()
                .withSources(new PropertiesConfigSource(props, "blueprint", 100)).build();
        IdentityPort port = IdentitySelection.select("oidc", LaunchMode.NORMAL, config);
        assertFalse(port instanceof UnconfiguredIdentity, file);

        List<String> required = RequiredProvidersReadiness.parse(env.get("GCSP_REQUIRED_PROVIDERS"));
        assertTrue(required.contains("identity"), file);
        HealthCheckResponse ready = RequiredProvidersReadiness.evaluate(k -> props.get(k), true, required);
        assertEquals(HealthCheckResponse.Status.UP, ready.getStatus(), file + " " + ready.getData());
    }

    /** The API service's key to value pairs; a null value marks a sync: false key. */
    private static Map<String, String> apiEnv(Path file, String service) throws IOException {
        Map<String, String> env = new LinkedHashMap<>();
        boolean inService = false;
        String key = null;
        for (String line : Files.readAllLines(file)) {
            if (line.startsWith("  - type:")) {
                inService = false;
            } else if (line.equals("    name: " + service)) {
                inService = true;
            }
            if (!inService) continue;
            Matcher k = KEY.matcher(line);
            Matcher v = VALUE.matcher(line);
            if (k.matches()) {
                key = k.group(1);
            } else if (key != null && v.matches()) {
                env.put(key, unquote(v.group(1)));
                key = null;
            } else if (key != null && SYNC_FALSE.matcher(line).matches()) {
                env.put(key, null);
                key = null;
            }
        }
        assertTrue(env.containsKey("GCSP_OIDC_ACCOUNTS"), "no API service " + service + " in " + file);
        return env;
    }

    private static String unquote(String raw) {
        String v = raw.replaceFirst("\\s+#.*$", "").trim();
        boolean quoted = v.length() >= 2 && (v.startsWith("'") && v.endsWith("'") || v.startsWith("\"") && v.endsWith("\""));
        return quoted ? v.substring(1, v.length() - 1) : v;
    }
}
