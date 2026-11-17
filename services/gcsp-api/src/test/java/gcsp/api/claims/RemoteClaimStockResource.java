package gcsp.api.claims;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.ClaimCompositionSeed;
import gcsp.api.remote.RemoteOperationServer;
import gcsp.api.remote.RemoteOperationServer.Execute;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.postgresql.ds.PGSimpleDataSource;

/**
 * Starts the loopback stock endpoint the app's real HttpClaimStock is configured against, and hands the instance to
 * the test through inject(). With seed-restart it also plays a previous process that lost a claim's answer.
 */
public class RemoteClaimStockResource implements QuarkusTestResourceLifecycleManager {

    /** Marks the test field that receives the running loopback server. */
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    public @interface InjectRemote {}

    static final String PRIOR_COMMAND = "restart-prior-claim";
    static final String PRIOR_EMPLOYEE = "employee-prior";
    static final String PRIOR_CAR = "prior-car";

    private Map<String, String> args = Map.of();
    private RemoteOperationServer remote;

    @Override
    public void init(Map<String, String> initArgs) {
        args = initArgs;
    }

    @Override
    public Map<String, String> start() {
        try {
            remote = RemoteOperationServer.start();
            ClaimCompositionSeed.dropSchema(args.get("schema"));
            if (Boolean.parseBoolean(args.get("seed-restart"))) seedPreviousProcess(args.get("schema"));
            Map<String, String> c = new HashMap<>();
            c.put("gcsp.claims.stock.execute-url", remote.baseUrl() + "/execute");
            c.put("gcsp.claims.stock.reconcile-url", remote.baseUrl() + "/reconcile");
            c.put("gcsp.claims.stock.timeout", "2s");
            return c;
        } catch (Exception e) {
            stop();
            throw new IllegalStateException("claim stock test resource failed to start", e);
        }
    }

    @Override
    public void inject(TestInjector injector) {
        injector.injectIntoFields(remote, new TestInjector.AnnotatedAndMatchesType(InjectRemote.class,
                RemoteOperationServer.class));
    }

    @Override
    public void stop() {
        if (remote != null) {
            remote.close();
            remote = null;
        }
        try {
            ClaimCompositionSeed.dropSchema(args.get("schema"));
        } catch (Exception e) {
            throw new IllegalStateException("could not drop the claim schema", e);
        }
    }

    /** The previous process: migrates the schema and commits one remote claim whose answer was lost, then exits. */
    private void seedPreviousProcess(String schema) throws Exception {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        if (url == null || url.isBlank()) return;
        PGSimpleDataSource plain = new PGSimpleDataSource();
        plain.setUrl(url);
        Flyway.configure().dataSource(plain).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        PGSimpleDataSource pool = new PGSimpleDataSource();
        pool.setUrl(url);
        pool.setCurrentSchema(schema);
        String env = ClaimCompositionSeed.ENV;
        String run = ClaimCompositionSeed.RUN;
        ObjectNode facts = ClaimFixture.Selection.facts().put("orderNumber", ClaimFixture.orderNumber(PRIOR_CAR));
        try (Connection c = pool.getConnection(); Statement st = c.createStatement()) {
            st.execute("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES ('" + env + "', true)");
            st.execute("INSERT INTO runs (environment_id, run_id, status) VALUES ('" + env + "', '" + run + "', 'active')");
            st.execute("INSERT INTO employees (environment_id, run_id, employee_id) VALUES ('" + env + "', '" + run
                    + "', '" + PRIOR_EMPLOYEE + "')");
            st.execute("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES ('"
                    + env + "', '" + run + "', 'slot-" + PRIOR_EMPLOYEE + "', '" + PRIOR_EMPLOYEE + "', 1)");
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO stock_cars (environment_id, run_id, order_uuid, "
                    + "configuration_id, state, attributes) VALUES (?, ?, ?, 'cfg-1', 'released', ?::jsonb)")) {
                ps.setString(1, env);
                ps.setString(2, run);
                ps.setString(3, PRIOR_CAR);
                ps.setString(4, facts.toString());
                ps.executeUpdate();
            }
        }
        ClaimFixture.Clock clock = new ClaimFixture.Clock();
        clock.now = Instant.parse(ClaimCompositionSeed.ACCOUNT_NOW);
        ClaimFixture.Selection selection = new ClaimFixture.Selection();
        ManualClaims previous = new ManualClaims(pool, clock, new ClaimFixture.Timing(), selection,
                new ClaimFixture.Offers(), remote.claimStock());
        ClaimScope scope = new ClaimScope(env, run, "actor-" + PRIOR_EMPLOYEE, PRIOR_EMPLOYEE, "gcsp-policy-v1");
        ObjectNode input = ClaimFixture.JSON.createObjectNode().put("commandId", PRIOR_COMMAND).put("orderUuid", PRIOR_CAR)
                .put("expectedStockVersion", 1).put("expectedDraftVersion", 1).put("expectedContextVersion", "ctx-1")
                .put("expectedTermsDigest", ManualClaims.termsDigest("gcsp-policy-v1", selection.terms));
        remote.onExecute(Execute.APPLY_THEN_DROP);
        ClaimResult answer = previous.claim(scope, input);
        if (!(answer instanceof ClaimResult.Pending)) {
            throw new IllegalStateException("the previous process should have lost the claim answer: " + answer);
        }
    }
}
