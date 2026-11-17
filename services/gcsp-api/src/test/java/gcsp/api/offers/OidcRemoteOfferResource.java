package gcsp.api.offers;

import gcsp.api.remote.RemoteOperationServer;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.util.HashMap;
import java.util.Map;

/**
 * Seeds an acknowledged remote-offered boundary before Quarkus starts; it does not produce a claim or send email.
 * The existing fixture's direct service objects are unused: measured decisions go through the application's HTTP route.
 * The parent runner also owns the disposable database, covering fixture failures before open returns its schema handle.
 */
public class OidcRemoteOfferResource implements QuarkusTestResourceLifecycleManager {

    private RemoteOperationServer remote;
    private DecisionEnv fixture;

    @Override
    public Map<String, String> start() {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        if (url == null || url.isBlank()) {
            throw new IllegalStateException("GCSP_TEST_DATABASE_URL is required for the OIDC remote-offer test");
        }
        try {
            remote = RemoteOperationServer.start();
            fixture = DecisionEnv.open(false);
            fixture.makeRemoteOffered(remote.buddy());
            Map<String, String> c = new HashMap<>();
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", url);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", fixture.pg.schema);
            c.put("quarkus.flyway.schemas", fixture.pg.schema);
            c.put("quarkus.flyway.default-schema", fixture.pg.schema);
            c.put("gcsp.environment-id", OffersPg.ENV);
            c.put("gcsp.database.expected-name", "gcsp_test_dev");
            c.put("gcsp.reset-allowed", "true");
            c.put("gcsp.buddy.execute-url", remote.baseUrl() + "/execute");
            c.put("gcsp.buddy.reconcile-url", remote.baseUrl() + "/reconcile");
            c.put("gcsp.buddy.timeout", "2s");
            c.put("gcsp.test.oidc-remote-offer.offer-id", fixture.offerId);
            return c;
        } catch (Exception e) {
            RuntimeException cleanup = closeOwnedResources();
            if (cleanup != null) e.addSuppressed(cleanup);
            throw new IllegalStateException("OIDC remote-offer test resource failed to start", e);
        }
    }

    @Override
    public void stop() {
        RuntimeException failure = closeOwnedResources();
        if (failure != null) throw failure;
    }

    private RuntimeException closeOwnedResources() {
        RuntimeException failure = null;
        if (fixture != null) {
            DecisionEnv closing = fixture;
            fixture = null;
            try {
                closing.close();
            } catch (Exception e) {
                failure = new IllegalStateException("Could not close the owned remote-offer fixture", e);
            }
        }
        if (remote != null) {
            RemoteOperationServer closing = remote;
            remote = null;
            try {
                closing.close();
            } catch (RuntimeException e) {
                if (failure == null) failure = e;
                else failure.addSuppressed(e);
            }
        }
        return failure;
    }
}
