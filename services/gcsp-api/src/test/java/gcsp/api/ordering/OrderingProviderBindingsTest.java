package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import gcsp.api.ordering.OrderingProviderBindings.Binding;
import gcsp.api.ordering.OrderingProviderPort.ProviderRequest;
import gcsp.api.ordering.OrderingProviderPort.ProviderResponse;
import gcsp.api.ordering.OrderingProviderPort.Status;
import java.lang.reflect.Proxy;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

/** Plain-JUnit component checks of the ordering binding; no Quarkus boot, database or remote application startup. */
class OrderingProviderBindingsTest {

    private static final Duration T = Duration.ofSeconds(5);
    private static final Optional<String> NONE = Optional.empty();
    private static final OrderingScope SCOPE = new OrderingScope("isolated-dev", "run-9", "employee-9", "slot-9", "policy-v9");
    private static final ProviderRequest REQUEST = new ProviderRequest("operation-9", "operation-9", "b".repeat(64),
            "exact-car-9", "7654321", "configuration-9", "HR approval");

    /** A datasource whose every connection attempt fails and is counted, so no database is ever reached. */
    private static DataSource countingDataSource(AtomicInteger connections) {
        return (DataSource) Proxy.newProxyInstance(DataSource.class.getClassLoader(), new Class<?>[] {DataSource.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("getConnection")) {
                        connections.incrementAndGet();
                        throw new SQLException("no database in this test");
                    }
                    throw new UnsupportedOperationException(method.getName());
                });
    }

    @Test
    void blankOrNoneDelegatesToTheUnconfiguredProviderAndOwnsNoClient() {
        for (String mode : new String[] {null, "", "  ", "none", " none "}) {
            Binding b = OrderingProviderBindings.configure(mode, NONE, NONE, NONE, T, false);
            assertEquals("none", b.mode());
            assertInstanceOf(UnconfiguredOrderingProvider.class, b.provider(null));
            assertTrue(b.ownedClient().isEmpty());
        }
    }

    @Test
    void syntheticDelegatesToTheUnchangedSelectionWithTheCallersDataSource() {
        AtomicInteger connections = new AtomicInteger();
        DataSource ds = countingDataSource(connections);
        Binding b = OrderingProviderBindings.configure(" synthetic ", NONE, NONE, NONE, T, false);
        assertEquals("synthetic", b.mode());
        assertTrue(b.ownedClient().isEmpty());
        OrderingProviderPort p = b.provider(ds);
        assertInstanceOf(SyntheticOrderingProvider.class, p);
        assertEquals(0, connections.get(), "binding never opens a connection");
        ProviderResponse r = p.reconcile(SCOPE, REQUEST);
        assertEquals(1, connections.get(), "the synthetic provider uses the datasource the caller passed");
        assertEquals(Status.UNKNOWN, r.status());
        assertEquals("ordering-store-unavailable", r.reason());
    }

    @Test
    void remoteCapturesOneValidatedHttpAdapterWithoutAnyNetworkCall() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        server.createContext("/", exchange -> {
            calls.incrementAndGet();
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });
        server.start();
        Binding b = null;
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            b = OrderingProviderBindings.configure(" remote ", Optional.of(base + "/ordering/execute"),
                    Optional.of(base + "/ordering/reconcile"), Optional.of("test-token-not-real"), T, true);
            assertEquals("remote", b.mode());
            OrderingProviderPort p = b.provider(null);
            assertInstanceOf(HttpOrderingProvider.class, p);
            assertSame(p, b.provider(null), "one adapter per startup, not one per call");
            assertEquals("remote", p.mode());
            assertEquals(HttpOrderingProvider.PROVIDER, p.provider());
            HttpClient client = b.ownedClient().orElseThrow();
            assertEquals(HttpClient.Redirect.NEVER, client.followRedirects());
            assertEquals(Optional.of(T), client.connectTimeout());
            assertEquals(0, calls.get(), "binding never calls the remote");
        } finally {
            if (b != null) b.close();
            server.stop(0);
        }
    }

    @Test
    void remoteWithMissingSettingsFailsClosedAndNamesOnlyTheKeys() {
        var e = assertThrows(IllegalStateException.class,
                () -> OrderingProviderBindings.configure("remote", NONE, Optional.of(""), NONE, T, false));
        assertEquals("gcsp.ordering.provider=remote needs valid settings: gcsp.ordering.execute-url, "
                + "gcsp.ordering.reconcile-url", e.getMessage());
        var timeout = assertThrows(IllegalStateException.class, () -> OrderingProviderBindings.configure("remote",
                Optional.of("https://ordering.invalid/x"), Optional.of("https://ordering.invalid/y"), NONE, null, false));
        assertEquals("gcsp.ordering.provider=remote needs valid settings: gcsp.ordering.timeout", timeout.getMessage());
    }

    @Test
    void remoteWithInvalidSettingsFailsClosedWithoutEchoingEndpointsOrToken() {
        String secretHost = "secret-ordering-host.invalid";
        String secretToken = "s3cret token";
        var e = assertThrows(IllegalStateException.class, () -> OrderingProviderBindings.configure("remote",
                Optional.of("http://" + secretHost + "/execute"), Optional.of("https://" + secretHost + "/r?q=1"),
                Optional.of(secretToken), Duration.ofSeconds(61), true));
        assertEquals("gcsp.ordering.provider=remote needs valid settings: gcsp.ordering.execute-url, "
                + "gcsp.ordering.reconcile-url, gcsp.ordering.token, gcsp.ordering.timeout", e.getMessage());
        assertFalse(e.getMessage().contains(secretHost));
        assertFalse(e.getMessage().contains(secretToken));
        // Plain loopback http is a test allowance only; outside TEST it is refused like any other http.
        var loopback = assertThrows(IllegalStateException.class, () -> OrderingProviderBindings.configure("remote",
                Optional.of("http://127.0.0.1:1/execute"), Optional.of("http://127.0.0.1:1/reconcile"), NONE, T, false));
        assertTrue(loopback.getMessage().contains("gcsp.ordering.execute-url"));
        assertThrows(IllegalStateException.class, () -> OrderingProviderBindings.configure("remote",
                Optional.of("https://ordering.invalid/x"), Optional.of("https://ordering.invalid/y"), NONE, Duration.ZERO,
                false));
    }

    @Test
    void anUnknownOrDifferentlyCasedModeStopsStartup() {
        for (String mode : new String[] {"live", "Remote", "Synthetic", "bmw"}) {
            var e = assertThrows(IllegalStateException.class,
                    () -> OrderingProviderBindings.configure(mode, NONE, NONE, NONE, T, false));
            assertEquals("Unknown gcsp.ordering.provider '" + mode + "'; supported: none, synthetic, remote", e.getMessage());
        }
    }

    @Test
    void closingShutsDownTheOwnedClientAndThenRefusesToHandOutAPort() throws Exception {
        Binding remote = OrderingProviderBindings.configure("remote", Optional.of("https://ordering.invalid/execute"),
                Optional.of("https://ordering.invalid/reconcile"), NONE, T, false);
        HttpClient client = remote.ownedClient().orElseThrow();
        assertFalse(client.isTerminated());
        remote.close();
        assertTrue(client.awaitTermination(Duration.ofSeconds(5)), "an idle client terminates promptly");
        assertThrows(IllegalStateException.class, () -> remote.provider(null));
        remote.close();
        Binding none = OrderingProviderBindings.configure("none", NONE, NONE, NONE, T, false);
        none.close();
        assertThrows(IllegalStateException.class, () -> none.provider(null));
    }

    @Test
    void theConfiguredInstanceLifecycleFollowsTheCurrentSelection() {
        OrderingProviderBindings bindings = newBindings("synthetic");
        assertThrows(IllegalStateException.class, bindings::mode, "nothing is handed out before init");
        bindings.init();
        assertEquals("synthetic", bindings.mode());
        assertInstanceOf(SyntheticOrderingProvider.class, bindings.provider(countingDataSource(new AtomicInteger())));
        bindings.close();
        assertThrows(IllegalStateException.class, () -> bindings.provider(null));
        OrderingProviderBindings unset = newBindings(null);
        unset.init();
        assertEquals("none", unset.mode());
        unset.close();
        // OrderingSelection now accepts remote; the binding then fails closed without settings and binds one adapter with them.
        OrderingProviderBindings missing = newBindings(" remote ");
        assertEquals("remote", missing.selection.provider());
        var e = assertThrows(IllegalStateException.class, missing::init);
        assertTrue(e.getMessage().contains("gcsp.ordering.execute-url"));
        assertThrows(IllegalStateException.class, missing::mode, "a failed init hands nothing out");
        OrderingProviderBindings remote = newBindings("remote");
        remote.executeUrl = Optional.of("https://ordering.invalid/execute");
        remote.reconcileUrl = Optional.of("https://ordering.invalid/reconcile");
        remote.init();
        assertEquals("remote", remote.mode());
        OrderingProviderPort port = remote.provider(null);
        assertInstanceOf(HttpOrderingProvider.class, port);
        assertSame(port, remote.provider(countingDataSource(new AtomicInteger())), "the datasource does not change remote");
        remote.close();
        assertThrows(IllegalStateException.class, () -> remote.provider(null));
    }

    private static OrderingProviderBindings newBindings(String providerName) {
        OrderingSelection selection = new OrderingSelection();
        selection.providerName = providerName;
        selection.init();
        OrderingProviderBindings bindings = new OrderingProviderBindings();
        bindings.selection = selection;
        bindings.executeUrl = bindings.reconcileUrl = bindings.token = NONE;
        bindings.timeout = Duration.ofSeconds(10);
        return bindings;
    }
}
