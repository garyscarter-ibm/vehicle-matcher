package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.regex.Pattern;

/** Port of readActiveChoiceModel (model/policy.js): the pinned policy reference, then its verified artifact. */
public final class ActiveChoiceModel {

    public static final String REFERENCE_KEY = "choice.model.reference";
    private static final Pattern DAY = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");

    /** The artifact and the activation row (the policy assumption naming it). */
    public record Active(ModelArtifact artifact, JsonNode activation, String policyVersion) {}

    private ActiveChoiceModel() {}

    private static boolean nonEmpty(JsonNode v) {
        return v != null && v.isTextual() && !v.textValue().isEmpty();
    }

    /** Returns the active model, or null for any gap: Node answers choice-policy-unavailable for all of them. */
    public static Active read(PolicyService policy, PolicyRead read, ModelArtifacts artifacts) {
        try {
            PolicyResult version = policy.getActiveVersion(read);
            if (!version.ok() || version.policyVersion() == null || version.policyVersion().isEmpty()) return null;
            PolicyResult out = policy.getAssumption(REFERENCE_KEY, new PolicyRead(read.runId(), read.asOf(), version.policyVersion()));
            JsonNode row = out.value();
            if (!out.ok() || !version.policyVersion().equals(out.policyVersion()) || !Js.isString(Js.get(row, "key"), REFERENCE_KEY)
                    || !Js.isString(Js.get(row, "policyVersion"), version.policyVersion()) || !nonEmpty(row.get("unit"))
                    || !nonEmpty(row.get("basis")) || !nonEmpty(row.get("source")) || !nonEmpty(row.get("sourceDate"))
                    || !DAY.matcher(row.get("sourceDate").textValue()).matches()
                    || !(Js.isString(row.get("status"), "assumed") || Js.isString(row.get("status"), "verified"))) return null;
            JsonNode reference = row.get("value");
            if (!(reference != null && reference.isObject() && nonEmpty(reference.get("artifactId"))
                    && ModelArtifact.validId(reference.get("artifactId").textValue())
                    && referenceSchemaOk(reference) && nonEmpty(reference.get("featureVersion"))
                    && ChoiceFeatures.known(reference.get("featureVersion").textValue()))) return null;
            ModelArtifact artifact = artifacts.read(reference.get("artifactId").textValue());
            if (!artifact.featureVersion().equals(reference.get("featureVersion").textValue())) return null;
            return new Active(artifact, row, version.policyVersion());
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static boolean referenceSchemaOk(JsonNode reference) {
        JsonNode v = reference.get("schemaVersion");
        return v != null && v.isNumber() && v.doubleValue() == 1;
    }
}
