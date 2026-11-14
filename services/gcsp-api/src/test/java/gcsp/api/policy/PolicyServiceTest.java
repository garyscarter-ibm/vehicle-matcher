package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PolicyServiceTest {

    private static final PolicyRead READ = new PolicyRead("run-1", "2026-11-04T12:00:00.000Z", null);
    private static final String HOLD = "hold.cart.durationSeconds";

    @TempDir
    Path dir;

    private static PolicyService defaultService() {
        return new PolicyService(new RetainedFilePolicySource(Seeds.SEED_PATH, List.of()));
    }

    @Test
    void mutatingAReturnedResultDoesNotAffectLaterReads() {
        PolicyService service = defaultService();
        PolicyResult first = service.getAssumption(HOLD, READ);
        int before = first.value().get("value").intValue();
        ((ObjectNode) first.value()).put("value", -1);
        first.body().put("status", "tampered");
        ((ObjectNode) service.getActiveVersion(READ).value()).put("policyVersion", "tampered");
        assertEquals(before, service.getAssumption(HOLD, READ).value().get("value").intValue());
        assertEquals("gcsp-policy-v1", service.getActiveVersion(READ).value().get("policyVersion").textValue());
    }

    @Test
    void mutatingEligibilityProvenanceDoesNotAffectLaterReads() {
        PolicyService service = defaultService();
        JsonNode mapping = service.getAssumption("eligibility.context.mapping", READ).value().get("value").get(0);
        PolicyContext context = new PolicyContext("run-1", mapping.get("companyId").textValue(),
                mapping.get("schemeId").textValue(), mapping.get("gradeIds").get(1).textValue());
        JsonNode car = Seeds.MAPPER.createObjectNode().put("eligibilityModelKey", "G20 Saloon|320i");
        PolicyResult first = service.getEligibility(context, car, READ);
        assertTrue(first.ok());
        JsonNode expected = first.value().deepCopy();
        ((ObjectNode) first.value().get("provenance").get("rules").get(0)).put("effect", "exclude");
        ((ObjectNode) first.value()).put("eligible", false);
        assertNull(JsonCompare.diff(expected, service.getEligibility(context, car, READ).value()));
    }

    @Test
    void snapshotIsACopyAndTheSuppliedSourceNodesAreNeverRetained() throws Exception {
        ObjectNode seed = Seeds.seed();
        List<JsonNode> answer = List.of(seed);
        PolicyService service = new PolicyService(runId -> answer);
        PolicyResult snapshot = service.getPolicySnapshot(READ);
        assertTrue(snapshot.ok());
        ((ObjectNode) snapshot.value()).put("policyVersion", "tampered");
        Seeds.assumption(seed, HOLD).put("value", 9999);
        assertEquals("gcsp-policy-v1", service.getPolicySnapshot(READ).value().get("policyVersion").textValue());
        assertEquals(120, service.getAssumption(HOLD, READ).value().get("value").intValue());
    }

    @Test
    void sourceErrorDoesNotPoisonALaterSuccessfulRead() throws IOException {
        Path file = dir.resolve("policy.json");
        PolicyService service = new PolicyService(new RetainedFilePolicySource(file, List.of()));
        PolicyResult missing = service.getActiveVersion(READ);
        assertEquals("unavailable", missing.status());
        assertEquals("source-unavailable", missing.code());
        assertNull(missing.policyVersion());
        assertEquals("The policy source is unavailable.", missing.body().get("reason").textValue());
        assertTrue(missing.body().get("retryable").booleanValue());
        Files.writeString(file, "not json");
        assertEquals("source-invalid", service.getActiveVersion(READ).code());
        Files.writeString(file, Seeds.seed().toString());
        PolicyResult recovered = service.getActiveVersion(READ);
        assertTrue(recovered.ok());
        assertEquals("gcsp-policy-v1", recovered.policyVersion());
    }

    @Test
    void changingTheSourceAnswerBetweenCallsIsPickedUpWhenUnpinned() {
        AtomicInteger calls = new AtomicInteger();
        ObjectNode original = Seeds.seed();
        ObjectNode changed = Seeds.seed();
        Seeds.assumption(changed, HOLD).put("value", 167);
        List<JsonNode> older = List.of(original);
        List<JsonNode> newer = List.of(changed);
        PolicyService service = new PolicyService(runId -> calls.getAndIncrement() == 0 ? older : newer);
        assertEquals(120, service.getAssumption(HOLD, READ).value().get("value").intValue());
        assertEquals(167, service.getAssumption(HOLD, READ).value().get("value").intValue());
        assertEquals(2, calls.get());
    }

    @Test
    void unpinnedReadsAskTheSourceEveryTime() {
        List<JsonNode> answer = List.of(Seeds.seed());
        AtomicInteger calls = new AtomicInteger();
        PolicyService service = new PolicyService(runId -> {
            calls.incrementAndGet();
            return answer;
        });
        for (int i = 0; i < 3; i++) {
            assertTrue(service.getActiveVersion(READ).ok());
        }
        assertEquals(3, calls.get());
    }

    @Test
    void fileSourceLoadsOnceAndSurvivesLaterFileChanges() throws IOException {
        Path file = dir.resolve("policy.json");
        Files.writeString(file, Seeds.seed().toString());
        PolicyService service = new PolicyService(new RetainedFilePolicySource(file, List.of()));
        assertTrue(service.getActiveVersion(READ).ok());
        Files.delete(file);
        assertTrue(service.getActiveVersion(READ).ok());
    }

    @Test
    void anUnexpectedSourceRuntimeFailureIsReportedAsUnavailableWithoutDetail() {
        PolicyService service = new PolicyService(runId -> {
            throw new IllegalStateException("/secret/path leaked");
        });
        PolicyResult result = service.getActiveVersion(READ);
        assertEquals("source-unavailable", result.code());
        assertFalse(result.body().toString().contains("secret"));
    }

    @Test
    void failuresCarryTheContractVersionAndNullPolicyVersionWhereNoneResolved() {
        PolicyResult invalid = defaultService().getActiveVersion(new PolicyRead("", "x", null));
        assertEquals("invalid-read", invalid.code());
        assertEquals("1.0.0", invalid.body().get("contractVersion").textValue());
        assertTrue(invalid.body().get("policyVersion").isNull());
        PolicyResult unknown = defaultService().getAssumption("no.such", READ);
        assertEquals("gcsp-policy-v1", unknown.policyVersion());
        assertNotNull(unknown.body().get("reasons"));
        assertFalse(unknown.ok());
        assertNull(unknown.value());
    }

    @Test
    void eligibilityIndexIsBuiltOncePerIntervalAndStaysCorrectAcrossRuleExpiry() throws IOException {
        PolicyService service = new PolicyService(Seeds.source("expiring-rule", dir));
        JsonNode rule = Seeds.seed().get("eligibilityRules").get(0);
        JsonNode mapping = defaultService().getAssumption("eligibility.context.mapping", READ).value().get("value");
        String scheme = null;
        for (JsonNode link : Seeds.seed().get("schemeRuleLinks")) {
            if (link.get("ruleId").equals(rule.get("ruleId"))) {
                scheme = link.get("schemeId").textValue();
            }
        }
        JsonNode m = null;
        for (JsonNode candidate : mapping) {
            if (candidate.get("schemeId").textValue().equals(scheme)) {
                m = candidate;
            }
        }
        PolicyContext context = new PolicyContext(null, m.get("companyId").textValue(), scheme,
                rule.get("gradeIds").get(0).textValue());
        JsonNode car = Seeds.MAPPER.createObjectNode().put("eligibilityModelKey", rule.get("value").textValue());
        for (int i = 0; i < 3; i++) {
            assertEquals("explicit-include", service.getEligibility(context, car, new PolicyRead("run-1",
                    "2026-11-09T23:59:59.999Z", null)).value().get("reasons").get(0).textValue());
        }
        assertEquals("no-applicable-include", service.getEligibility(context, car, new PolicyRead("run-1",
                "2026-11-10T00:00:00Z", null)).value().get("reasons").get(0).textValue());
    }

    @Test
    void instantParsingFollowsDateParse() {
        assertEquals(1767139260000L, PolicyTime.parse("2026-01-01T00:00:00+23:59").getAsLong());
        assertEquals(1767225600500L, PolicyTime.parse("2026-01-01T00:00:00.5Z").getAsLong());
        assertEquals(-62167219200000L, PolicyTime.parse("0000-01-01T00:00:00Z").getAsLong());
        assertTrue(PolicyTime.parse("2026-01-01T00:00:00+24:00").isEmpty());
        assertTrue(PolicyTime.parse("2026-02-30T00:00:00Z").isEmpty());
        assertTrue(PolicyTime.parse("2026-11-04T24:00:00Z").isEmpty());
        assertTrue(PolicyTime.validDay("2028-02-29"));
        assertFalse(PolicyTime.validDay("2026-02-29"));
    }
}
