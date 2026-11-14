package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/** Trusted caller context for the stock route; a null context or null members are untrusted. */
public record EvidenceContext(String runId, String environmentId, String principalId, List<String> roles) {

    public static EvidenceContext fromJson(JsonNode node) {
        if (node == null || !node.isObject()) return null;
        List<String> roles = null;
        JsonNode array = node.get("roles");
        if (array != null && array.isArray()) {
            roles = new ArrayList<>();
            for (JsonNode role : array) roles.add(role.isTextual() ? role.textValue() : null);
        }
        return new EvidenceContext(textOrNull(node.get("runId")), textOrNull(node.get("environmentId")),
                textOrNull(node.get("principalId")), roles);
    }

    boolean trusted() {
        return Js.text(runId) && Js.text(environmentId) && Js.text(principalId) && roles != null
                && roles.stream().allMatch(Js::text);
    }

    private static String textOrNull(JsonNode node) {
        return node != null && node.isTextual() ? node.textValue() : null;
    }
}
