package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.evidence.BoundedVehicleRead.Response;
import gcsp.api.evidence.VehicleRouting.Route;

/** Adapts the same-process lookup port; no self-HTTP and no private registry access. */
public final class LookupVehicleAdapter implements VehicleProvider {

    private final BoundedVehicleRead read;

    public LookupVehicleAdapter(VehicleLookupPort lookup, VehicleRouting route, int timeoutMs, int maxAttempts) {
        this.read = new BoundedVehicleRead("in-process", timeoutMs, maxAttempts, (request, context, signal) -> {
            Route denied = route == null ? null : route.route(request, context);
            if (denied != null && denied.denied()) return new Response(null, EvidenceFailures.failure(denied.denial(), request.kind()));
            if (signal.aborted()) return new Response(null, EvidenceFailures.failure("source-unavailable", request.kind()));
            JsonNode result = lookup == null ? null : lookup.resolve(new EvidenceRequest(request.kind(), request.id(), null), context);
            return new Response(null, route == null ? result : route.routedResult(request, context, result));
        });
    }

    @Override
    public ProviderResponse resolve(EvidenceRequest trusted, EvidenceContext context) {
        return read.resolve(trusted, context);
    }
}
