package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.evidence.CorpusResults.Classification;
import gcsp.api.evidence.StockPort.RunLookup;
import gcsp.api.evidence.StockPort.StockClassification;

/** Server-owned identity routing (identity-routing.js): no live branch, URL or fallback; a miss never proves a real VIN. */
public final class VehicleRouting {

    /** The retained classification of a request; liveEligible must be false or the request is unavailable. */
    record Classified(String status, String identityKind, boolean liveEligible, String configurationId, String vehicleId) {}

    @FunctionalInterface
    interface Classifier {
        Classified classify(EvidenceRequest request, EvidenceContext context);
    }

    /** A denial status ("not-found", "identity-mismatch", "source-unavailable") or the immutable binding. */
    public record Route(String denial, String configurationId, String vehicleId) {

        public boolean denied() {
            return denial != null;
        }
    }

    private final Classifier classifier;

    /** provider is "lookup" or "alternate-offline"; anything else is a configuration error. */
    public VehicleRouting(CorpusStore identity, StockPort stock, String provider) {
        this((request, context) -> classify(identity, stock, request, context), provider);
    }

    VehicleRouting(Classifier classifier, String provider) {
        if (!("lookup".equals(provider) || "alternate-offline".equals(provider))) {
            throw new IllegalArgumentException("Unsupported configured vehicle provider.");
        }
        this.classifier = classifier;
    }

    /** Called inside each bounded attempt, before the provider read. */
    public Route route(EvidenceRequest request, EvidenceContext context) {
        try {
            String id = request == null ? null : VehicleIdentifiers.canonical(request.kind(), request.id());
            if (classifier == null || id == null) return denied("source-unavailable");
            Classified result = classifier.classify(new EvidenceRequest(request.kind(), id, null), context);
            if (result == null || result.liveEligible()) return denied("source-unavailable");
            if ("identity-mismatch".equals(result.status())) return denied("identity-mismatch");
            if ("ok".equals(result.status()) && "synthetic".equals(result.identityKind())) {
                String vehicleId = result.vehicleId() == null || result.vehicleId().isEmpty() ? null : result.vehicleId();
                return new Route(null, result.configurationId(), vehicleId);
            }
            if ("not-found".equals(result.status()) && "unknown".equals(result.identityKind())) return denied("not-found");
            return denied("source-unavailable");
        } catch (RuntimeException e) {
            return denied("source-unavailable");
        }
    }

    /** Rechecks the same authority after the read; a provider cannot replace an immutable association. */
    public JsonNode routedResult(EvidenceRequest request, EvidenceContext context, JsonNode result) {
        JsonNode status = Js.field(result, "status");
        if (!(Js.is(status, "complete") || Js.is(status, "partial"))) return result;
        Route binding = route(request, context);
        if (binding.denied()) return EvidenceFailures.failure(binding.denial(), request.kind());
        JsonNode identity = result.get("identity");
        if (!Js.is(Js.field(identity, "identityKind"), "synthetic")
                || !Js.is(identity.get("configurationId"), binding.configurationId())
                || binding.vehicleId() != null && !Js.is(identity.get("vehicleId"), binding.vehicleId())) {
            return EvidenceFailures.failure("identity-mismatch", request.kind());
        }
        return result;
    }

    private static Route denied(String status) {
        return new Route(status, null, null);
    }

    private static Classified unavailable() {
        return new Classified("source-unavailable", "unknown", false, null, null);
    }

    private static Classified mismatch() {
        return new Classified("identity-mismatch", "unknown", false, null, null);
    }

    private static Classified classify(CorpusStore identity, StockPort stock, EvidenceRequest request, EvidenceContext context) {
        if (identity == null) return unavailable();
        try {
            String kind = request.kind();
            if ("vin".equals(kind) || "configuration".equals(kind)) {
                Classification classified = "vin".equals(kind) ? identity.classifyIdentity(request.id())
                        : identity.classifyConfiguration(request.id());
                // An empty or unselected store is unavailable, never proof of a valid empty corpus.
                if ("not-found".equals(classified.status()) && "source-unavailable".equals(identity.status().status())) {
                    return unavailable();
                }
                return new Classified(classified.status(), classified.identityKind(), classified.liveEligible(),
                        classified.configurationId(), classified.vehicleId());
            }
            if (!"stock".equals(kind) || context == null || context.environmentId() == null || context.runId() == null
                    || stock == null) {
                return unavailable();
            }
            RunLookup current = stock.currentRun(context.environmentId());
            if (current == null || !"ok".equals(current.status())) return unavailable();
            if (!context.runId().equals(current.runId())) return mismatch();
            StockClassification row = stock.classify(context, request.id());
            if (row == null) return unavailable();
            if ("not-found".equals(row.status())) return new Classified("not-found", "unknown", false, null, null);
            if ("identity-mismatch".equals(row.status())) return mismatch();
            if (!"ok".equals(row.status())) return unavailable();
            Classification configuration = identity.classifyConfiguration(row.configurationId());
            if (!"ok".equals(configuration.status()) || !"synthetic".equals(configuration.identityKind())) return unavailable();
            return new Classified("ok", "synthetic", false, row.configurationId(), row.vehicleId());
        } catch (RuntimeException e) {
            return unavailable();
        }
    }
}
