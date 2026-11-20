package gcsp.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.JsonWebKeySet;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jwk.RsaJwkGenerator;
import org.jose4j.lang.JoseException;

/**
 * Serves a freshly generated public JWKS on loopback; the private JWKs reach tests as config. The
 * {@code /control/*} paths let a @QuarkusTest rotate in the second key, take the JWKS down and count fetches.
 */
public class JwksServerResource implements QuarkusTestResourceLifecycleManager {

    static final String KID = "test-key-1";
    static final String ROTATION_KID = "test-key-2";
    private final AtomicInteger fetches = new AtomicInteger();
    private final AtomicBoolean rotated = new AtomicBoolean();
    private final AtomicBoolean down = new AtomicBoolean();
    private HttpServer server;

    @Override
    public Map<String, String> start() {
        try {
            RsaJsonWebKey key = RsaJwkGenerator.generateJwk(2048);
            key.setKeyId(KID);
            RsaJsonWebKey second = RsaJwkGenerator.generateJwk(2048);
            second.setKeyId(ROTATION_KID);
            byte[] before = publicSet(key);
            byte[] after = publicSet(key, second);
            server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
            server.createContext("/jwks", ex -> {
                fetches.incrementAndGet();
                if (down.get()) {
                    reply(ex, 503, "text/plain", "down".getBytes(StandardCharsets.UTF_8));
                } else {
                    reply(ex, 200, "application/json", rotated.get() ? after : before);
                }
            });
            server.createContext("/control/rotate", ex -> control(ex, () -> rotated.set(true)));
            server.createContext("/control/down", ex -> control(ex, () -> down.set(true)));
            server.createContext("/control/fetches", ex -> control(ex, () -> {}));
            server.start();
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            return Map.of(
                    "gcsp.oidc.jwks-uri", base + "/jwks",
                    "gcsp.test.jwks-control", base + "/control",
                    "gcsp.test.signing-jwk", key.toJson(JsonWebKey.OutputControlLevel.INCLUDE_PRIVATE),
                    "gcsp.test.rotation-jwk", second.toJson(JsonWebKey.OutputControlLevel.INCLUDE_PRIVATE));
        } catch (JoseException | IOException e) {
            throw new IllegalStateException("test JWKS server failed to start", e);
        }
    }

    private static byte[] publicSet(JsonWebKey... keys) {
        return new JsonWebKeySet(keys).toJson(JsonWebKey.OutputControlLevel.PUBLIC_ONLY)
                .getBytes(StandardCharsets.UTF_8);
    }

    /** Applies a control action, then answers with the JWKS fetch count so far. */
    private void control(HttpExchange ex, Runnable action) throws IOException {
        action.run();
        reply(ex, 200, "text/plain", Integer.toString(fetches.get()).getBytes(StandardCharsets.UTF_8));
    }

    private static void reply(HttpExchange ex, int status, String type, byte[] body) throws IOException {
        ex.getResponseHeaders().add("Content-Type", type);
        ex.sendResponseHeaders(status, body.length);
        ex.getResponseBody().write(body);
        ex.close();
    }

    @Override
    public void stop() {
        if (server != null) {
            server.stop(0);
        }
    }
}
