package gcsp.api.notify;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Supplier;

/** A local Brevo stand-in on 127.0.0.1: scriptable per request (status, body, delay, headers), records requests. */
final class BrevoStub implements AutoCloseable {

    record Request(String method, String path, java.util.Map<String, String> headers, String body) {}

    record Reply(int status, String body, long delayMillis, String location) {}

    static Reply reply(int status, String body) {
        return new Reply(status, body, 0, null);
    }

    static Reply created(String messageId) {
        return reply(201, "{\"messageId\":\"" + messageId + "\"}");
    }

    final List<Request> requests = new CopyOnWriteArrayList<>();
    final List<Supplier<Reply>> script = new ArrayList<>();
    private final HttpServer server;

    BrevoStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        server.createContext("/", exchange -> {
            java.util.Map<String, String> headers = new java.util.HashMap<>();
            exchange.getRequestHeaders().forEach((k, v) -> headers.put(k.toLowerCase(java.util.Locale.ROOT), v.get(0)));
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            requests.add(new Request(exchange.getRequestMethod(), exchange.getRequestURI().getPath(), headers, body));
            int i = Math.min(requests.size(), script.size()) - 1;
            Reply r = script.isEmpty() ? reply(500, "{}") : script.get(i).get();
            try {
                if (r.delayMillis() > 0) Thread.sleep(r.delayMillis());
                if (r.location() != null) exchange.getResponseHeaders().add("Location", r.location());
                byte[] out = r.body().getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(r.status(), out.length == 0 ? -1 : out.length);
                if (out.length > 0) exchange.getResponseBody().write(out);
            } catch (InterruptedException | IOException e) {
                // A client that timed out has gone away.
            } finally {
                exchange.close();
            }
        });
        server.start();
    }

    BrevoStub then(Reply reply) {
        script.add(() -> reply);
        return this;
    }

    URI endpoint() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v3/smtp/email");
    }

    URI other() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/elsewhere");
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
