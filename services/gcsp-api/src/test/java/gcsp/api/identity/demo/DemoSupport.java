package gcsp.api.identity.demo;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.scenario.DemoPreparationFile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

/** A valid demo-issuer configuration over the real demo people, for the settings and token tests. */
final class DemoSupport {

    static final String ISSUER = "https://demo.example.test/demo-idp";
    static final List<DemoPerson> PEOPLE = DemoPerson.from(DemoPreparationFile.load());
    private static final ObjectMapper JSON = new ObjectMapper();

    private DemoSupport() {}

    static String accountsJson(List<DemoPerson> people) {
        ArrayNode all = JSON.createArrayNode();
        for (DemoPerson p : people) {
            ObjectNode n = all.addObject();
            n.put("subject", p.principalId());
            ArrayNode roles = n.putArray("roles");
            p.roles().forEach(roles::add);
            if (p.roles().contains("employee")) n.put("employeeId", p.employeeId());
        }
        return all.toString();
    }

    static Map<String, String> valid() {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.demo-idp.enabled", "true");
        m.put("gcsp.identity.provider", "oidc");
        m.put("gcsp.scenario.provider", "demo");
        m.put("gcsp.oidc.issuer", ISSUER);
        m.put("gcsp.oidc.jwks-uri", ISSUER + "/jwks");
        m.put("gcsp.oidc.audience", "gcsp-api");
        m.put("gcsp.oidc.authorized-party", "gcsp-web");
        m.put("gcsp.oidc.required-scopes", "gcsp-api");
        m.put("gcsp.oidc.accounts", accountsJson(PEOPLE));
        m.put("gcsp.demo-idp.redirect-uris", "https://web.example.test/gcsp/auth/callback");
        m.put("gcsp.demo-idp.post-logout-redirect-uris", "https://web.example.test/gcsp/");
        m.put("gcsp.demo-idp.access-token-lifetime", "10m");
        m.put("gcsp.demo-idp.refresh-token-lifetime", "12h");
        return m;
    }

    static Function<String, Optional<String>> lookup(Map<String, String> m) {
        return k -> Optional.ofNullable(m.get(k));
    }
}
