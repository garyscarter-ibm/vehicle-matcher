package gcsp.api.offers;

import gcsp.api.JwksServerResource;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** OIDC and real application bindings over one seeded remote offer; only the dated policy clock is replaced. */
public class OidcRemoteOfferProfile extends OffersTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = super.getConfigOverrides();
        c.put("gcsp.environment.id", OffersPg.ENV);
        c.put("gcsp.environment.run-id", "run-1");
        c.put("gcsp.environment.policy-version", DecisionEnv.POLICY);
        c.put("gcsp.account.provider", "repository");
        c.put("gcsp.buddy.provider", "remote");
        c.put("gcsp.claims.stock.provider", "local");
        c.put("gcsp.ordering.provider", "synthetic");
        c.put("gcsp.scenario.provider", "none");
        c.put("gcsp.mail.transport", "captured");
        c.put("gcsp.mail.public-base-url", "https://gcsp.example.test");
        c.put("gcsp.claims.sweep-interval", "10m");
        c.put("gcsp.notify.drain-interval", "10m");
        // OffersHttpTest's global in-memory alternative must not replace the production PostgreSQL reader here.
        c.put("quarkus.arc.exclude-types", OffersTestPorts.Records.class.getName());
        return c;
    }

    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of(FixturePolicyClock.class);
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class),
                new TestResourceEntry(OidcRemoteOfferResource.class));
    }

    /** Scoped to this profile: it keeps the retained quote valid, without claiming run-clock integration. */
    @Alternative
    @ApplicationScoped
    public static class FixturePolicyClock implements PolicyClock {
        @Override
        public Instant now(RunContext context) {
            return DecisionEnv.NOW;
        }
    }
}
