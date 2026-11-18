package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import jakarta.enterprise.inject.Vetoed;
import java.io.IOException;
import java.io.InputStream;

/** The buddy run's policy view (Node buddyOverrides): the hold-duration overlay and the reviewed decline-reason registry. */
@Vetoed
final class BuddyPolicy extends PolicyService {

    static final String HOLD_KEY = "hold.buddy.durationSeconds";
    static final String REASONS_KEY = "offer.declineReasons.v1";
    private static final String REVIEWED = "gcsp/policy/reviewed/offer-decline-reasons-v1.json";

    private final PolicyService inner;
    private final JsonNode hold;
    private final JsonNode reasons;

    private BuddyPolicy(PolicyService inner, JsonNode hold, JsonNode reasons) {
        super(null);
        this.inner = inner;
        this.hold = hold;
        this.reasons = reasons;
    }

    static PolicyService of(PolicyService inner, ObjectNode manifest) {
        JsonNode hold = null;
        for (JsonNode row : manifest.get("assumptions")) if (HOLD_KEY.equals(row.get("key").textValue())) hold = row;
        JsonNode reasons = reviewed();
        ReplayRecords.check(hold != null && reasons != null, "buddy-overrides");
        return new BuddyPolicy(inner, hold, reasons);
    }

    private static JsonNode reviewed() {
        try (InputStream in = BuddyPolicy.class.getClassLoader().getResourceAsStream(REVIEWED)) {
            if (in == null) return null;
            for (JsonNode row : ReplayRecords.MAPPER.readTree(in).get("definitions")) {
                if (REASONS_KEY.equals(row.get("key").textValue())) return row;
            }
            return null;
        } catch (IOException e) {
            return null;
        }
    }

    @Override
    public PolicyResult getAssumption(String key, PolicyRead read) {
        PolicyResult result = inner.getAssumption(key, read);
        if (key.equals(HOLD_KEY) && result.ok() && hold.path("overlay").asBoolean(false)) {
            ObjectNode body = result.body().deepCopy();
            ObjectNode row = (ObjectNode) body.get("value");
            row.set("value", hold.get("value").deepCopy());
            row.put("overlay", true);
            row.set("baselineValue", hold.get("baselineValue").deepCopy());
            return new PolicyResult(result.status(), result.policyVersion(), body);
        }
        // Only an absent key is supplied from the reviewed set, at the run's own pinned version.
        if (key.equals(REASONS_KEY) && !result.ok() && "unknown-assumption".equals(result.code()) && read != null
                && read.policyVersion() != null && read.policyVersion().equals(result.policyVersion())) {
            ObjectNode row = ((ObjectNode) reasons).deepCopy();
            row.put("policyVersion", read.policyVersion());
            PolicyResult adapter = inner.getAssumption("comparison.recordAdapter.v1", read);
            if (!adapter.ok()) return result;
            row.set("effectiveFrom", adapter.value().get("effectiveFrom"));
            ObjectNode body = ReplayRecords.JSON.objectNode();
            body.put("status", "ok");
            body.set("value", row);
            body.put("contractVersion", PolicyService.CONTRACT_VERSION);
            body.put("policyVersion", read.policyVersion());
            return new PolicyResult("ok", read.policyVersion(), body);
        }
        return result;
    }

    @Override
    public PolicyResult getPolicySnapshot(PolicyRead read) {
        return inner.getPolicySnapshot(read);
    }

    @Override
    public PolicyResult getActiveVersion(PolicyRead read) {
        return inner.getActiveVersion(read);
    }

    @Override
    public PolicyResult getAllowance(PolicyContext context, PolicyRead read) {
        return inner.getAllowance(context, read);
    }

    @Override
    public PolicyResult getPointsCost(PolicyContext context, JsonNode car, PolicyRead read) {
        return inner.getPointsCost(context, car, read);
    }

    @Override
    public PolicyResult getEligibility(PolicyContext context, JsonNode car, PolicyRead read) {
        return inner.getEligibility(context, car, read);
    }
}
