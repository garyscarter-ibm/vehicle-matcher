package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;

/** The default evidence: the released row's attributes.facts, exactly as Node passes them on; FUCQ-459 replaces it. */
@DefaultBean
@ApplicationScoped
public final class StockFactsEvidence implements VehicleEvidencePort {

    @Override
    public Optional<JsonNode> snapshot(RunContext scope, String orderUuid, String configurationId, JsonNode releasedFacts) {
        return releasedFacts == null || releasedFacts.isNull() ? Optional.empty() : Optional.of(releasedFacts);
    }
}
