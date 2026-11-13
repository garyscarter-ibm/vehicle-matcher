package gcsp.api;

import com.sun.net.httpserver.HttpServer;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.JsonWebKeySet;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jwk.RsaJwkGenerator;
import org.jose4j.lang.JoseException;

/** Serves a freshly generated public JWKS on loopback; the private JWK reaches tests as config. */
public class JwksServerResource implements QuarkusTestResourceLifecycleManager {

    static final String KID = "test-key-1";
    private HttpServer server;

    @Override
    public Map<String, String> start() {
        try {
            RsaJsonWebKey key = RsaJwkGenerator.generateJwk(2048);
            key.setKeyId(KID);
            byte[] body = new JsonWebKeySet(key).toJson(JsonWebKey.OutputControlLevel.PUBLIC_ONLY)
                    .getBytes(StandardCharsets.UTF_8);
            server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
            server.createContext("/jwks", ex -> {
                ex.getResponseHeaders().add("Content-Type", "application/json");
                ex.sendResponseHeaders(200, body.length);
                ex.getResponseBody().write(body);
                ex.close();
            });
            server.start();
            return Map.of(
                    "gcsp.oidc.jwks-uri", "http://127.0.0.1:" + server.getAddress().getPort() + "/jwks",
                    "gcsp.test.signing-jwk", key.toJson(JsonWebKey.OutputControlLevel.INCLUDE_PRIVATE));
        } catch (JoseException | IOException e) {
            throw new IllegalStateException("test JWKS server failed to start", e);
        }
    }

    @Override
    public void stop() {
        if (server != null) {
            server.stop(0);
        }
    }
}
