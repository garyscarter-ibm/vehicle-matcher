package gcsp.api.ordering;

import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.remote.OperationHttpTransport;
import gcsp.api.remote.OperationHttpTransport.Ids;
import gcsp.api.remote.OperationHttpTransport.RemoteOperationException;
import gcsp.api.remote.OperationHttpTransport.Settings;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** The GCSP remote ordering substitute; its acknowledgement is fictional, never verified BMW execution. */
public final class HttpOrderingProvider implements OrderingProviderPort {

    public static final String PROVIDER = "remote-ordering-substitute:v1";
    private static final ObjectMapper JSON = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .build();

    private final Settings settings;
    private final HttpClient http;

    public HttpOrderingProvider(Settings settings, HttpClient http) {
        this.settings = Objects.requireNonNull(settings, "settings");
        this.http = Objects.requireNonNull(http, "http");
        if (http.followRedirects() != HttpClient.Redirect.NEVER) {
            throw new IllegalArgumentException("The remote ordering HTTP client must never follow redirects");
        }
    }

    @Override
    public String mode() {
        return "remote";
    }

    @Override
    public String provider() {
        return PROVIDER;
    }

    @Override
    public ProviderResponse execute(OrderingScope scope, ProviderRequest request) {
        return exchange(scope, request, true);
    }

    @Override
    public ProviderResponse reconcile(OrderingScope scope, ProviderRequest request) {
        return exchange(scope, request, false);
    }

    private ProviderResponse exchange(OrderingScope scope, ProviderRequest r, boolean execute) {
        if (!valid(scope, r)) return unknown("remote-operation-invalid");
        try {
            HttpRequest.Builder request;
            if (execute) {
                byte[] body = JSON.writeValueAsBytes(body(scope, r));
                request = base(settings.executeUri()).header("Content-Type", "application/json")
                        .header("Idempotency-Key", r.idempotencyKey())
                        .POST(HttpRequest.BodyPublishers.ofByteArray(body));
            } else {
                URI lookup = OperationHttpTransport.reconcileUri(settings.reconcileUri(),
                        new Ids(r.operationId(), scope.runId(), r.orderUuid()));
                request = base(lookup).GET();
            }
            return send(request, scope, r);
        } catch (RemoteOperationException e) {
            return unknown(e.code());
        } catch (IOException e) {
            return unknown("remote-operation-invalid");
        } catch (RuntimeException e) {
            return unknown("remote-transport-failed");
        }
    }

    private static ObjectNode body(OrderingScope scope, ProviderRequest r) {
        return JSON.createObjectNode().put("operationId", r.operationId()).put("idempotencyKey", r.idempotencyKey())
                .put("inputDigest", r.inputDigest()).put("orderUuid", r.orderUuid()).put("orderNumber", r.orderNumber())
                .put("configurationId", r.configurationId()).put("firstApprovalStage", r.firstApprovalStage())
                .put("environmentId", scope.environmentId()).put("runId", scope.runId()).put("employeeId", scope.employeeId())
                .put("entitlementSlotId", scope.entitlementSlotId()).put("policyVersion", scope.policyVersion());
    }

    private HttpRequest.Builder base(URI uri) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri).timeout(settings.timeout())
                .header("Accept", "application/json");
        settings.token().ifPresent(token -> builder.header("Authorization", "Bearer " + token));
        return builder;
    }

    private ProviderResponse send(HttpRequest.Builder request, OrderingScope scope, ProviderRequest r)
            throws RemoteOperationException {
        CompletableFuture<HttpResponse<byte[]>> pending = null;
        try {
            pending = http.sendAsync(request.build(), info -> new BoundedBody(info.statusCode()));
            // EOF belongs to the same deadline as headers, including a body that stalls after its first byte.
            HttpResponse<byte[]> response = pending.get(settings.timeout().toNanos(), TimeUnit.NANOSECONDS);
            if (response.statusCode() != 200) throw new RemoteOperationException("remote-http-status");
            if (response.body().length > OperationHttpTransport.MAX_BODY) {
                throw new RemoteOperationException("remote-ack-malformed");
            }
            return parse(response.body(), scope, r);
        } catch (TimeoutException e) {
            if (pending != null) pending.cancel(true);
            throw new RemoteOperationException("remote-timeout");
        } catch (InterruptedException e) {
            if (pending != null) pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new RemoteOperationException("remote-interrupted");
        } catch (ExecutionException e) {
            for (Throwable cause = e.getCause(); cause != null; cause = cause.getCause()) {
                if (cause instanceof HttpTimeoutException) throw new RemoteOperationException("remote-timeout");
            }
            throw new RemoteOperationException("remote-transport-failed");
        } catch (RuntimeException e) {
            if (pending != null) pending.cancel(true);
            throw new RemoteOperationException("remote-transport-failed");
        }
    }

    private static ProviderResponse parse(byte[] raw, OrderingScope scope, ProviderRequest r)
            throws RemoteOperationException {
        JsonNode node;
        try {
            node = JSON.readTree(raw);
        } catch (IOException e) {
            throw new RemoteOperationException("remote-ack-malformed");
        }
        if (node == null || !node.isObject()) throw new RemoteOperationException("remote-ack-malformed");
        Status status = switch (text(node, "status")) {
            case "confirmed" -> Status.CONFIRMED;
            case "rejected" -> Status.REJECTED;
            case "unsupported" -> Status.UNSUPPORTED;
            case "not-found" -> Status.NOT_FOUND;
            case "unknown" -> Status.UNKNOWN;
            default -> throw new RemoteOperationException("remote-ack-status-unknown");
        };
        String operationId = text(node, "operationId");
        String runId = text(node, "runId");
        String orderUuid = text(node, "orderUuid");
        if (!r.operationId().equals(operationId) || !scope.runId().equals(runId) || !r.orderUuid().equals(orderUuid)) {
            throw new RemoteOperationException("remote-ack-mismatch");
        }
        JsonNode fictional = node.get("fictional");
        if (fictional == null || !fictional.isBoolean() || !fictional.booleanValue()) {
            throw new RemoteOperationException("remote-ack-malformed");
        }
        if (status == Status.CONFIRMED) {
            String orderNumber = text(node, "orderNumber");
            String configurationId = text(node, "configurationId");
            String orderStatus = text(node, "orderStatus");
            String reference = text(node, "providerReference");
            if (reference.length() > OperationHttpTransport.MAX_REFERENCE) {
                throw new RemoteOperationException("remote-ack-malformed");
            }
            if (!r.orderNumber().equals(orderNumber) || !r.configurationId().equals(configurationId)
                    || !r.firstApprovalStage().equals(orderStatus)) {
                throw new RemoteOperationException("remote-ack-mismatch");
            }
            return new ProviderResponse(status, operationId, runId, orderUuid, orderNumber, configurationId,
                    orderStatus, reference, null, fictional.booleanValue());
        }
        for (String field : List.of("orderNumber", "configurationId", "orderStatus", "providerReference")) {
            if (node.hasNonNull(field)) throw new RemoteOperationException("remote-ack-malformed");
        }
        String reason = switch (status) {
            case REJECTED -> "remote-ordering-rejected";
            case UNSUPPORTED -> "remote-ordering-unsupported";
            case UNKNOWN -> "remote-ordering-unknown";
            default -> null;
        };
        return new ProviderResponse(status, operationId, runId, orderUuid, null, null, null, null, reason,
                fictional.booleanValue());
    }

    private static String text(JsonNode node, String field) throws RemoteOperationException {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) {
            throw new RemoteOperationException("remote-ack-malformed");
        }
        return value.textValue();
    }

    private static boolean valid(OrderingScope scope, ProviderRequest r) {
        return scope != null && r != null && notBlank(scope.environmentId()) && notBlank(scope.runId())
                && notBlank(scope.employeeId()) && notBlank(scope.entitlementSlotId()) && notBlank(scope.policyVersion())
                && notBlank(r.operationId()) && notBlank(r.idempotencyKey())
                && r.idempotencyKey().chars().allMatch(c -> c > 0x20 && c < 0x7f) && notBlank(r.orderUuid())
                && r.orderNumber() != null && r.orderNumber().matches("[0-9]{7}") && notBlank(r.configurationId())
                && notBlank(r.firstApprovalStage()) && r.inputDigest() != null && r.inputDigest().matches("[0-9a-f]{64}");
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }

    private static ProviderResponse unknown(String reason) {
        return new ProviderResponse(Status.UNKNOWN, null, null, null, null, null, null, null, reason, false);
    }

    /** Cancels without draining non-200 or oversized bodies; never retains more than MAX_BODY + 1 bytes. */
    private static final class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> body = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final int status;
        private Flow.Subscription subscription;

        private BoundedBody(int status) {
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
                int count = Math.min(buffer.remaining(), OperationHttpTransport.MAX_BODY + 1 - bytes.size());
                byte[] chunk = new byte[count];
                buffer.get(chunk);
                bytes.writeBytes(chunk);
                if (bytes.size() > OperationHttpTransport.MAX_BODY) {
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
}
