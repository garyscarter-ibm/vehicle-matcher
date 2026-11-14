package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.evidence.VehicleProvider.ProviderResponse;
import gcsp.api.evidence.VehicleProvider.Transport;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** One finite, cancellable provider read per attempt on a virtual thread. This class has no network capability. */
public final class BoundedVehicleRead implements VehicleProvider {

    public static final int DEFAULT_TIMEOUT_MS = 1000;
    public static final int DEFAULT_ATTEMPTS = 1;
    private static final ExecutorService ATTEMPTS = Executors.newVirtualThreadPerTaskExecutor();

    /** Set when an attempt's deadline passes or it fails; an attempt that cannot be interrupted polls it. */
    public static final class Signal {
        private volatile boolean aborted;

        public boolean aborted() {
            return aborted;
        }

        void abort() {
            aborted = true;
        }
    }

    /** What an attempt returns; a null response is an invalid envelope and fails the attempt. */
    public record Response(Integer transportStatus, JsonNode result) {}

    @FunctionalInterface
    public interface Attempt {
        Response run(EvidenceRequest request, EvidenceContext context, Signal signal) throws Exception;
    }

    private final String protocol;
    private final int timeoutMs;
    private final int maxAttempts;
    private final Attempt read;

    /** Unknown protocols and out-of-range bounds are configuration errors (Node TypeError). */
    public BoundedVehicleRead(String protocol, int timeoutMs, int maxAttempts, Attempt read) {
        if (read == null || !("in-process".equals(protocol) || "offline".equals(protocol)) || timeoutMs < 1 || timeoutMs > 5000
                || maxAttempts < 1 || maxAttempts > 2) {
            throw new IllegalArgumentException("Configure a vehicle provider with a finite timeout and one or two attempts.");
        }
        this.protocol = protocol;
        this.timeoutMs = timeoutMs;
        this.maxAttempts = maxAttempts;
        this.read = read;
    }

    @Override
    public ProviderResponse resolve(EvidenceRequest trusted, EvidenceContext context) {
        Transport transport = null;
        for (int attempts = 1; attempts <= maxAttempts; attempts++) {
            Signal signal = new Signal();
            transport = new Transport(protocol, null, attempts, "unavailable");
            Future<Response> future = null;
            try {
                EvidenceRequest request = copy(trusted);
                EvidenceContext copied = copy(context);
                future = ATTEMPTS.submit(() -> read.run(request, copied, signal));
                Response response = future.get(timeoutMs, TimeUnit.MILLISECONDS);
                if (response == null) throw new IllegalStateException("Invalid provider envelope");
                Integer status = response.transportStatus();
                if (status != null && (status < 100 || status > 599)) throw new IllegalStateException("Invalid transport status");
                transport = new Transport(protocol, status, attempts, "unavailable");
                if (status != null && status != 200) throw new IllegalStateException("Provider transport did not succeed");
                JsonNode result = response.result();
                return new ProviderResponse(new Transport(protocol, status, attempts, "answered"),
                        result == null ? null : result.deepCopy());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                signal.abort();
                if (future != null) future.cancel(true);
                break;
            } catch (ExecutionException | TimeoutException | RuntimeException e) {
                signal.abort();
                if (future != null) future.cancel(true);
            }
        }
        return new ProviderResponse(transport, EvidenceFailures.failure("source-unavailable", trusted == null ? null : trusted.kind()));
    }

    private static EvidenceRequest copy(EvidenceRequest request) {
        return new EvidenceRequest(request.kind(), request.id(),
                request.expected() == null ? null : new LinkedHashMap<>(request.expected()), request.malformed());
    }

    private static EvidenceContext copy(EvidenceContext context) {
        if (context == null) return null;
        List<String> roles = context.roles() == null ? null : new ArrayList<>(context.roles());
        return new EvidenceContext(context.runId(), context.environmentId(), context.principalId(), roles);
    }
}
