package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.documents.DocumentService;
import gcsp.api.documents.DocumentsWiring;
import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Handover readiness from the documents service, the single readiness authority; unavailable while it is off. */
@ApplicationScoped
public class DocumentsHandoverReadiness implements HandoverReadinessPort {

    @Inject
    DocumentsWiring documents;

    @Override
    public HandoverReadiness read(RunContext context, String orderUuid) {
        try {
            DocumentService service = documents.service();
            if (service == null) return new HandoverReadiness.Unavailable();
            return map(service.readiness(context, orderUuid));
        } catch (RuntimeException e) {
            return new HandoverReadiness.Unavailable();
        }
    }

    /** Empty means documents were never opened for the order, so it is simply not ready. */
    static HandoverReadiness map(Optional<? extends JsonNode> readiness) {
        if (readiness.isEmpty()) return new HandoverReadiness.Ok(false, "not-open", false, false, List.of(), null);
        JsonNode n = readiness.get();
        List<String> blocking = new ArrayList<>();
        for (JsonNode b : n.path("blocking")) blocking.add(b.asText());
        return new HandoverReadiness.Ok(n.path("ready").asBoolean(false), n.path("state").asText("waiting"),
                n.path("documentsComplete").asBoolean(false), n.path("vehicleReady").asBoolean(false), blocking,
                n.hasNonNull("documentsRevision") ? n.get("documentsRevision").asText() : null);
    }
}
