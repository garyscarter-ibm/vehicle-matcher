package gcsp.api.remote;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import gcsp.api.allocation.HttpRemoteBuddy;
import gcsp.api.allocation.LocalSyntheticBuddy;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.claims.ClaimStockPort;
import gcsp.api.claims.HttpClaimStock;
import gcsp.api.claims.LocalClaimStock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.Optional;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** Remote startup/CDI selection plus bounded selector and PostConstruct lifecycle refusal checks. */
@QuarkusTest
@TestProfile(RemoteOperationProvidersTest.RemoteProfile.class)
class RemoteOperationProvidersTest {

    private static final String TOKEN = "test-token-not-real";
    private static final Duration T = Duration.ofSeconds(5);

    @Inject
    ClaimStockPort stock;

    @Inject
    RemoteBuddy buddy;

    public static class RemoteProfile implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            // No server at this address: selecting providers must never call it during startup.
            return Map.of(
                    "gcsp.claims.stock.provider", "remote",
                    "gcsp.claims.stock.execute-url", "http://127.0.0.1:1/stock/execute",
                    "gcsp.claims.stock.reconcile-url", "http://127.0.0.1:1/stock/reconcile",
                    "gcsp.buddy.provider", "remote",
                    "gcsp.buddy.execute-url", "http://127.0.0.1:1/buddy/execute",
                    "gcsp.buddy.reconcile-url", "http://127.0.0.1:1/buddy/reconcile");
        }
    }

    @Test
    void theRemoteProfileInjectsBothHttpPortsThroughTheSelector() {
        assertEquals(ClaimStockPort.Mode.REMOTE, stock.mode());
        assertEquals("remote", buddy.mode());
    }

    @Test
    void thePostConstructLifecycleRefusesUnknownOrMissingRemoteSettings() {
        var unknown = configuredLocalSelector();
        unknown.buddyProvider = "unknown";
        var e = assertThrows(IllegalStateException.class, unknown::init);
        assertTrue(e.getMessage().contains("gcsp.buddy.provider"));
        var remote = configuredLocalSelector();
        remote.stockProvider = "remote";
        var missing = assertThrows(IllegalStateException.class, remote::init);
        assertTrue(missing.getMessage().contains("gcsp.claims.stock.execute-url"));
        assertTrue(missing.getMessage().contains("gcsp.claims.stock.reconcile-url"));
    }

    private static RemoteOperationProviders configuredLocalSelector() {
        var selector = new RemoteOperationProviders();
        selector.stockProvider = "local";
        selector.buddyProvider = "local-synthetic";
        selector.stockExecute = selector.stockReconcile = selector.stockToken = Optional.empty();
        selector.buddyExecute = selector.buddyReconcile = selector.buddyToken = Optional.empty();
        selector.stockTimeout = selector.buddyTimeout = T;
        return selector;
    }

    @Test
    void unsetOrBlankProvidersAreLocal() {
        for (String name : new String[] {null, "", "  ", "local"}) {
            assertInstanceOf(LocalClaimStock.class, RemoteOperationProviders.claimStock(name, Optional.empty(),
                    Optional.empty(), Optional.empty(), T, false));
        }
        for (String name : new String[] {null, "", "local-synthetic"}) {
            assertInstanceOf(LocalSyntheticBuddy.class, RemoteOperationProviders.remoteBuddy(name, Optional.empty(),
                    Optional.empty(), Optional.empty(), T, false));
        }
    }

    @Test
    void remoteSelectsTheHttpAdaptersWithoutAnyNetworkCall() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        server.createContext("/", exchange -> {
            calls.incrementAndGet();
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            ClaimStockPort s = RemoteOperationProviders.claimStock(" remote ", Optional.of(base + "/stock/execute"),
                    Optional.of(base + "/stock/reconcile"), Optional.of(TOKEN), T, true);
            RemoteBuddy b = RemoteOperationProviders.remoteBuddy("remote", Optional.of(base + "/buddy/execute"),
                    Optional.of(base + "/buddy/reconcile"), Optional.empty(), T, true);
            assertInstanceOf(HttpClaimStock.class, s);
            assertEquals(ClaimStockPort.Mode.REMOTE, s.mode());
            assertInstanceOf(HttpRemoteBuddy.class, b);
            assertEquals("remote", b.mode());
            assertEquals(0, calls.get(), "selection never calls the remote");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void anUnknownProviderStopsStartupAndNamesTheKey() {
        var e = assertThrows(IllegalStateException.class, () -> RemoteOperationProviders.claimStock("bmw",
                Optional.empty(), Optional.empty(), Optional.empty(), T, false));
        assertEquals("Unknown gcsp.claims.stock.provider 'bmw'; supported: local, remote", e.getMessage());
        var b = assertThrows(IllegalStateException.class, () -> RemoteOperationProviders.remoteBuddy("Remote",
                Optional.empty(), Optional.empty(), Optional.empty(), T, false));
        assertEquals("Unknown gcsp.buddy.provider 'Remote'; supported: local-synthetic, remote", b.getMessage());
        assertThrows(IllegalStateException.class, () -> RemoteOperationProviders.remoteBuddy("local",
                Optional.empty(), Optional.empty(), Optional.empty(), T, false), "Buddy's local name is local-synthetic");
    }

    @Test
    void remoteWithUnusableSettingsStopsStartupAndNeverFallsBackToLocal() {
        var missing = assertThrows(IllegalStateException.class, () -> RemoteOperationProviders.claimStock("remote",
                Optional.empty(), Optional.of(""), Optional.empty(), T, false));
        assertEquals("gcsp.claims.stock.provider=remote needs valid settings: gcsp.claims.stock.execute-url, "
                + "gcsp.claims.stock.reconcile-url", missing.getMessage());
        var plainHttp = assertThrows(IllegalStateException.class, () -> RemoteOperationProviders.remoteBuddy("remote",
                Optional.of("http://buddy.example.com/x"), Optional.of("https://buddy.example.com/y"),
                Optional.of(TOKEN + " x"), Duration.ofMinutes(2), false));
        assertEquals("gcsp.buddy.provider=remote needs valid settings: gcsp.buddy.execute-url, gcsp.buddy.token, "
                + "gcsp.buddy.timeout", plainHttp.getMessage());
        assertFalse(plainHttp.getMessage().contains(TOKEN), "a token value is never shown");
        assertThrows(IllegalStateException.class, () -> RemoteOperationProviders.claimStock("remote",
                Optional.of("http://127.0.0.1:1/x"), Optional.of("http://127.0.0.1:1/y"), Optional.empty(), T, false),
                "loopback http is only accepted in test launch mode");
    }

    @Test
    void productionStyleHttpsSettingsAreAccepted() {
        var s = RemoteOperationProviders.claimStock("remote", Optional.of("https://stock.example.com/ops"),
                Optional.of("https://stock.example.com/ops/lookup"), Optional.empty(), Duration.ofMillis(1), false);
        assertTrue(s instanceof HttpClaimStock);
    }
}
