package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountPolicyPort;
import gcsp.api.account.AccountScope;
import gcsp.api.brief.BriefAssumptions;
import gcsp.api.persistence.RunContext;
import gcsp.api.supply.PolicyReading;
import gcsp.api.supply.RetainedPolicyFile;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The consumer adapters over the retained seed: the same rows the Node consumers read, through one service. */
class PolicyAdaptersTest {

    private static final String NOW = "2026-11-05T09:00:00.000Z";
    private static final PolicyService SERVICE = new PolicyService(new RetainedFilePolicySource(Seeds.SEED_PATH, List.of()));
    private static final PolicyClock CLOCK = new PolicyClock() {
        @Override
        public Instant now(RunContext context) {
            return Instant.parse(NOW);
        }
    };

    private static PolicyBriefAdapter brief(String run) {
        return new PolicyBriefAdapter(SERVICE, CLOCK, Optional.of("env"), Optional.of(run));
    }

    @Test
    void theBriefAdapterReturnsEverySharedKeyOfThePinnedVersion() {
        Optional<BriefAssumptions> found = brief("run-1").assumptions("gcsp-policy-v1");
        assertTrue(found.isPresent());
        assertEquals("gcsp-policy-v1", found.get().policyVersion());
        assertEquals(BriefAssumptions.KEYS.size(), found.get().entries().size());
        assertEquals(7, found.get().entries().size());
        for (String key : BriefAssumptions.KEYS) {
            assertEquals(key, found.get().entries().get(key).get("key").textValue());
            assertEquals("gcsp-policy-v1", found.get().entries().get(key).get("policyVersion").textValue());
        }
    }

    @Test
    void theBriefAdapterIsEmptyForAnUnknownVersionABlankRunOrABlankVersion() {
        assertTrue(brief("run-1").assumptions("no-such-version").isEmpty());
        assertTrue(brief("").assumptions("gcsp-policy-v1").isEmpty());
        assertTrue(brief("  ").assumptions("gcsp-policy-v1").isEmpty());
        assertTrue(brief("run-1").assumptions("").isEmpty());
        assertTrue(brief("run-1").assumptions(null).isEmpty());
    }

    @Test
    void theBriefAdapterIsEmptyWhenAnyKeyIsMissingFromThePinnedVersion() {
        PolicyService missing = new PolicyService(new PolicySource() {
            @Override
            public List<JsonNode> loadVersions(String runId) throws PolicySourceException {
                ObjectNode seed = Seeds.seed();
                ((com.fasterxml.jackson.databind.node.ArrayNode) seed.get("assumptions"))
                        .removeIf(a -> BriefAssumptions.ENGAGEMENT.equals(a.get("key").textValue()));
                return List.of(seed);
            }
        });
        assertTrue(new PolicyBriefAdapter(missing, CLOCK, Optional.empty(), Optional.of("run-1"))
                .assumptions("gcsp-policy-v1").isEmpty());
    }

    private static AccountScope scope(String company, String scheme, String grade) {
        return new AccountScope("env", "run-1", "e1", null, List.of("employee"), company, scheme, grade, null,
                "gcsp-policy-v1");
    }

    @Test
    void theAccountAdapterMapsOkInvalidAndNotFoundWithoutLosingTheVersion() {
        PolicyAccountAdapter adapter = new PolicyAccountAdapter(SERVICE);
        AccountPolicyPort.PolicyRead read = new AccountPolicyPort.PolicyRead("run-1", NOW, null);
        AccountPolicyPort.PolicyOutcome rules = adapter.manualRules(read);
        assertEquals("ok", rules.status());
        assertNull(rules.code());
        assertEquals("gcsp-policy-v1", rules.policyVersion());
        assertEquals("manual.context.v1", rules.value().get("key").textValue());
        AccountPolicyPort.PolicyOutcome names = adapter.schemeDisplayNames(read);
        assertEquals("ok", names.status());
        assertEquals("scheme.displayNames.v1", names.value().get("key").textValue());

        JsonNode mapping = SERVICE.getAssumption("eligibility.context.mapping", new PolicyRead("run-1", NOW, null))
                .value().get("value").get(0);
        String company = mapping.get("companyId").textValue();
        String scheme = mapping.get("schemeId").textValue();
        String grade = mapping.get("gradeIds").get(0).textValue();
        AccountPolicyPort.PolicyOutcome allowance = adapter.allowance(scope(company, scheme, grade), read);
        assertEquals("ok", allowance.status());
        assertEquals(grade, allowance.value().get("gradeId").textValue());

        AccountPolicyPort.PolicyOutcome unknown = adapter.allowance(scope(company, "no-scheme", grade), read);
        assertEquals("invalid", unknown.status());
        assertEquals("unknown-scheme", unknown.code());
        assertNull(unknown.value());

        AccountPolicyPort.PolicyOutcome missing = adapter.manualRules(
                new AccountPolicyPort.PolicyRead("run-1", NOW, "no-such-version"));
        assertEquals("not-found", missing.status());
        assertEquals("policy-version-not-found", missing.code());
    }

    @Test
    void theReleaseAdapterReadsTheSameReadingAsTheRetainedFileReader() {
        Instant at = Instant.parse(NOW);
        PolicyReading expected = new RetainedPolicyFile(Seeds.SEED_PATH).read("run-1", at);
        PolicyReading actual = new PolicyReleaseAdapter(SERVICE).read("run-1", at);
        assertInstanceOf(PolicyReading.Ok.class, expected);
        assertEquals(expected, actual);
    }

    @Test
    void theReleaseAdapterIsUnavailableBeforeTheVersionStartsAndForBlankInput() {
        PolicyReleaseAdapter adapter = new PolicyReleaseAdapter(SERVICE);
        Instant before = Instant.parse("2026-11-01T00:00:00Z");
        assertInstanceOf(PolicyReading.Unavailable.class, adapter.read("run-1", before));
        assertInstanceOf(PolicyReading.Unavailable.class, new RetainedPolicyFile(Seeds.SEED_PATH).read("run-1", before));
        assertInstanceOf(PolicyReading.Unavailable.class, adapter.read("", Instant.parse(NOW)));
    }

    @Test
    void theReleaseAdapterRefusesAWrongUnitANonPositiveSizeAndMixedVersions() {
        Instant at = Instant.parse(NOW);
        assertInstanceOf(PolicyReading.Unavailable.class, new PolicyReleaseAdapter(serviceWith(seed -> {
            Seeds.assumption(seed, "supply.stockSource.maxAgeMinutes").put("unit", "hours");
        })).read("run-1", at));
        assertInstanceOf(PolicyReading.Unavailable.class, new PolicyReleaseAdapter(serviceWith(seed -> {
            Seeds.assumption(seed, "supply.release.size").put("value", 0);
        })).read("run-1", at));
        assertInstanceOf(PolicyReading.Unavailable.class, new PolicyReleaseAdapter(serviceWith(seed -> {
            Seeds.assumption(seed, "supply.leadTimeDays").put("value", -1);
        })).read("run-1", at));
        assertInstanceOf(PolicyReading.Unavailable.class, new PolicyReleaseAdapter(serviceWith(seed -> {
            Seeds.assumption(seed, "supply.leadTimeDays").put("value", 1.5);
        })).read("run-1", at));
    }

    private static PolicyService serviceWith(java.util.function.Consumer<ObjectNode> edit) {
        return new PolicyService(new PolicySource() {
            @Override
            public List<JsonNode> loadVersions(String runId) {
                ObjectNode seed = Seeds.seed();
                edit.accept(seed);
                return List.of(seed);
            }
        });
    }
}
