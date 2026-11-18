package gcsp.api.account;

import java.util.Map;

/** Public bridge to the documented dev composition (package-private fixtures) for the claims package's started-app proof. */
public final class ClaimCompositionSeed {

    public static final String ENV = AccountDevCompositionProfiles.ENV;
    public static final String RUN = AccountDevCompositionProfiles.RUN;
    /** The fixed instant the account clock reads in tests (gcsp.account.fixed-now). */
    public static final String ACCOUNT_NOW = "2026-11-05T09:00:00.000Z";

    private ClaimCompositionSeed() {}

    /** The dev composition (oidc, repository accounts, demo seeding, synthetic ordering, local stock) over the given schema. */
    public static Map<String, String> config(String schema) {
        Map<String, String> c = AccountDevCompositionProfiles.config(schema, "repository");
        c.put("gcsp.claims.stock.provider", "local");
        // Ticks are driven by the test so no background pass touches its rows.
        c.put("gcsp.claims.sweep-interval", "10m");
        c.put("gcsp.notify.drain-interval", "10m");
        return c;
    }

    /** An RS256 token for the subject with the employee role, verified by the loopback JWKS. */
    public static String token(String signingJwk, String sub) throws Exception {
        return AccountDevCompositionSupport.token(signingJwk, sub, "employee");
    }

    public static void dropSchema(String schema) throws Exception {
        AccountDevCompositionSupport.dropSchema(schema);
    }
}
