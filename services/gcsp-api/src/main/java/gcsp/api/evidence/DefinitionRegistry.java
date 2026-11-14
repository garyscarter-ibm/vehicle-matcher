package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;

/** Node withConfigurationDefinitions: joins selected definitions into a detached copy of each registry record. */
public final class DefinitionRegistry implements EvidenceRegistry {

    private final EvidenceRegistry inner;
    private final ConfigurationDefinitions definitions;

    public DefinitionRegistry(EvidenceRegistry inner, ConfigurationDefinitions definitions) {
        this.inner = inner;
        this.definitions = definitions;
    }

    @Override
    public EvidenceSource getConfiguration(String id) {
        return definitions.enrich(inner.getConfiguration(id));
    }

    @Override
    public EvidenceSource getVin(String id) {
        return definitions.enrich(inner.getVin(id));
    }

    public JsonNode definitionStatus() {
        return definitions.definitionStatus();
    }
}
