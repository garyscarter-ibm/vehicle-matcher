package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;

/** Identity of the selected corpus version; the JSON members are detached copies and must not be mutated. */
public record ActiveInfo(String datasetId, String version, String manifestDigest, JsonNode counts,
        JsonNode sourceContexts, JsonNode completeness) {}
