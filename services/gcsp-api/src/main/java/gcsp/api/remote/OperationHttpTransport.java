package gcsp.api.remote;

import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * The GCSP remote-operation substitute (FUCQ-481), not a BMW protocol: execute POSTs the operation, reconcile GETs a
 * same-id lookup. Only a 200 JSON acknowledgement echoing the sent ids is returned; everything else throws.
 */
public final class OperationHttpTransport {

    public static final int MAX_BODY = 64 * 1024;
    public static final int MAX_REFERENCE = 256;
    public static final Duration MAX_TIMEOUT = Duration.ofSeconds(60);
    private static final Set<String> STATUSES = Set.of("confirmed", "rejected", "not-found");
    private static final ObjectMapper JSON = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .build();

    /** The three ids every acknowledgement must echo exactly. */
    public record Ids(String operationId, String runId, String orderUuid) {}

    /** A validated acknowledgement; providerReference is null when the remote sent none. */
    public record Reply(String status, String operationId, String runId, String orderUuid, String providerReference) {}

    /** Validated settings for one port; prefix is the property prefix, and toString never shows the token. */
    public record Settings(String prefix, URI executeUri, URI reconcileUri, Optional<String> token, Duration timeout) {

        @Override
        public String toString() {
            return "Settings[" + prefix + ", execute=" + executeUri + ", reconcile=" + reconcileUri + ", timeout=" + timeout
                    + ", token=" + (token.isPresent() ? "set" : "unset") + "]";
        }

        /** Errors name the bad property keys only, never a value. Plain http is allowed only to loopback, in tests. */
        public static Settings parse(String prefix, Optional<String> executeUrl, Optional<String> reconcileUrl,
                Optional<String> token, Duration timeout, boolean loopbackHttpAllowed) {
            List<String> bad = new ArrayList<>();
            URI execute = uri(executeUrl, loopbackHttpAllowed);
            if (execute == null) bad.add(prefix + ".execute-url");
            URI reconcile = uri(reconcileUrl, loopbackHttpAllowed);
            if (reconcile == null) bad.add(prefix + ".reconcile-url");
            Optional<String> bearer = token == null ? Optional.empty() : token.filter(t -> !t.isEmpty());
            if (bearer.isPresent() && !headerSafe(bearer.get())) bad.add(prefix + ".token");
            if (timeout == null || timeout.isZero() || timeout.isNegative() || timeout.compareTo(MAX_TIMEOUT) > 0) {
                bad.add(prefix + ".timeout");
            }
            if (!bad.isEmpty()) {
                throw new IllegalStateException(prefix + ".provider=remote needs valid settings: " + String.join(", ", bad));
            }
            return new Settings(prefix, execute, reconcile, bearer, timeout);
        }
    }

    /** A failed or unusable call. The message is only the code: no URI, credential or upstream content. */
    public static final class RemoteOperationException extends Exception {

        private final String code;

        public RemoteOperationException(String code) {
            super(code, null, false, false);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }

    private final Settings settings;
    private final HttpClient http;

    public OperationHttpTransport(Settings settings, HttpClient http) {
        if (http.followRedirects() != HttpClient.Redirect.NEVER) {
            throw new IllegalArgumentException("The remote operation HTTP client must never follow redirects");
        }
        this.settings = settings;
        this.http = http;
    }

    /** The only client the transport accepts: redirects are never followed. Building it makes no network call. */
    public static HttpClient newClient(Duration connectTimeout) {
        return HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(connectTimeout).build();
    }

    public Settings settings() {
        return settings;
    }

    /** One POST of the operation JSON; never retried here, so a lost answer is the caller's reconcile to settle. */
    public Reply execute(Ids ids, JsonNode body) throws RemoteOperationException {
        check(ids);
        if (body == null || !body.isObject()) throw new RemoteOperationException("remote-operation-invalid");
        byte[] bytes;
        try {
            bytes = JSON.writeValueAsBytes(body);
        } catch (IOException e) {
            throw new RemoteOperationException("remote-operation-invalid");
        }
        HttpRequest.Builder request = base(settings.executeUri())
                .header("Content-Type", "application/json")
                .header("Idempotency-Key", ids.operationId())
                .POST(HttpRequest.BodyPublishers.ofByteArray(bytes));
        return send(request, ids);
    }

    /** A GET lookup by the same three ids; it never sends the operation, so it can never execute it. */
    public Reply reconcile(Ids ids) throws RemoteOperationException {
        check(ids);
        URI lookup;
        try {
            lookup = reconcileUri(settings.reconcileUri(), ids);
        } catch (IllegalArgumentException e) {
            throw new RemoteOperationException("remote-operation-invalid");
        }
        return send(base(lookup).GET(), ids);
    }

    /** base?operationId=..&runId=..&orderUuid=.., in that order, UTF-8 percent-encoded with a space as %20. */
    public static URI reconcileUri(URI base, Ids ids) {
        return URI.create(base.toString() + "?operationId=" + encode(ids.operationId()) + "&runId=" + encode(ids.runId())
                + "&orderUuid=" + encode(ids.orderUuid()));
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private HttpRequest.Builder base(URI uri) {
        HttpRequest.Builder b = HttpRequest.newBuilder(uri).timeout(settings.timeout()).header("Accept", "application/json");
        settings.token().ifPresent(t -> b.header("Authorization", "Bearer " + t));
        return b;
    }

    private static void check(Ids ids) throws RemoteOperationException {
        // Only operationId travels in a header; runId and orderUuid keep their stored contracts and are percent-encoded.
        if (ids == null || ids.operationId() == null || !headerSafe(ids.operationId()) || blank(ids.runId())
                || blank(ids.orderUuid())) {
            throw new RemoteOperationException("remote-operation-invalid");
        }
    }

    private static boolean blank(String id) {
        return id == null || id.isBlank();
    }

    /** Visible ASCII only, so a value can never split or inject a header. */
    private static boolean headerSafe(String value) {
        return !value.isEmpty() && value.chars().allMatch(c -> c > 0x20 && c < 0x7f);
    }

    private Reply send(HttpRequest.Builder builder, Ids ids) throws RemoteOperationException {
        CompletableFuture<HttpResponse<byte[]>> pending = null;
        try {
            pending = http.sendAsync(builder.build(), info -> new BoundedBody(info.statusCode()));
            // The subscriber completes only at EOF (or the size limit), so this deadline includes a stalled body.
            HttpResponse<byte[]> response = pending.get(settings.timeout().toNanos(), TimeUnit.NANOSECONDS);
            // A 404 is not authoritative not-found: only a parsed, matching body is.
            if (response.statusCode() != 200) throw new RemoteOperationException("remote-http-status");
            if (response.body().length > MAX_BODY) throw new RemoteOperationException("remote-ack-malformed");
            return parse(response.body(), ids);
        } catch (TimeoutException e) {
            if (pending != null) pending.cancel(true);
            throw new RemoteOperationException("remote-timeout");
        } catch (InterruptedException e) {
            if (pending != null) pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new RemoteOperationException("remote-interrupted");
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            while (cause != null) {
                if (cause instanceof HttpTimeoutException) throw new RemoteOperationException("remote-timeout");
                cause = cause.getCause();
            }
            throw new RemoteOperationException("remote-transport-failed");
        } catch (RuntimeException e) {
            if (pending != null) pending.cancel(true);
            throw new RemoteOperationException("remote-transport-failed");
        }
    }

    /** Captures at most MAX_BODY + 1 bytes; cancels without draining non-200 or oversized responses. */
    private static final class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> body = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final int status;
        private Flow.Subscription subscription;

        BoundedBody(int status) {
            this.status = status;
        }

        @Override
        public CompletionStage<byte[]> getBody() {
            return body;
        }

        @Override
        public void onSubscribe(Flow.Subscription incoming) {
            subscription = incoming;
            if (status != 200) {
                incoming.cancel();
                body.complete(new byte[0]);
            } else {
                incoming.request(1);
            }
        }

        @Override
        public void onNext(List<ByteBuffer> buffers) {
            for (ByteBuffer buffer : buffers) {
                int count = Math.min(buffer.remaining(), MAX_BODY + 1 - bytes.size());
                byte[] chunk = new byte[count];
                buffer.get(chunk);
                bytes.writeBytes(chunk);
                if (bytes.size() > MAX_BODY) {
                    subscription.cancel();
                    body.complete(bytes.toByteArray());
                    return;
                }
            }
            subscription.request(1);
        }

        @Override
        public void onError(Throwable error) {
            body.completeExceptionally(error);
        }

        @Override
        public void onComplete() {
            body.complete(bytes.toByteArray());
        }
    }

    static Reply parse(byte[] raw, Ids ids) throws RemoteOperationException {
        JsonNode node;
        try {
            node = JSON.readTree(raw);
        } catch (IOException e) {
            throw new RemoteOperationException("remote-ack-malformed");
        }
        if (node == null || !node.isObject()) throw new RemoteOperationException("remote-ack-malformed");
        String status = text(node, "status");
        String operationId = text(node, "operationId");
        String runId = text(node, "runId");
        String orderUuid = text(node, "orderUuid");
        JsonNode ref = node.get("providerReference");
        String reference = null;
        if (ref != null && !ref.isNull()) {
            if (!ref.isTextual() || ref.textValue().isEmpty() || ref.textValue().length() > MAX_REFERENCE) {
                throw new RemoteOperationException("remote-ack-malformed");
            }
            reference = ref.textValue();
        }
        if (!STATUSES.contains(status)) throw new RemoteOperationException("remote-ack-status-unknown");
        if (!ids.operationId().equals(operationId) || !ids.runId().equals(runId) || !ids.orderUuid().equals(orderUuid)) {
            throw new RemoteOperationException("remote-ack-mismatch");
        }
        return new Reply(status, operationId, runId, orderUuid, reference);
    }

    private static String text(JsonNode node, String field) throws RemoteOperationException {
        JsonNode v = node.get(field);
        if (v == null || !v.isTextual()) throw new RemoteOperationException("remote-ack-malformed");
        return v.textValue();
    }

    private static URI uri(Optional<String> value, boolean loopbackHttpAllowed) {
        String v = value == null ? "" : value.orElse("");
        if (v.isEmpty() || !v.equals(v.strip()) || v.chars().anyMatch(c -> c <= 0x20 || c >= 0x7f)) return null;
        try {
            URI uri = new URI(v);
            String host = uri.getHost();
            if (host == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
                return null;
            }
            if ("https".equals(uri.getScheme())) return uri;
            boolean loopback = host.equals("127.0.0.1") || host.equals("localhost") || host.equals("[::1]");
            return "http".equals(uri.getScheme()) && loopback && loopbackHttpAllowed ? uri : null;
        } catch (URISyntaxException e) {
            return null;
        }
    }
}
