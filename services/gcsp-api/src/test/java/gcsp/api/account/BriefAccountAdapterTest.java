package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.brief.BriefAccountPort.AccountFacts;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The brief's account port reads the same projection the account endpoint serves. */
class BriefAccountAdapterTest {

    private static Optional<AccountFacts> facts(GoldenFixture f, String policyVersion) {
        return new BriefAccountAdapter(f.service(), Optional.ofNullable(policyVersion))
                .facts(f.scope.environmentId(), f.scope.runId(), f.scope.employeeId());
    }

    @Test
    void currentContractAndVersionComeFromTheProjection() {
        GoldenFixture f = new GoldenFixture("paula");
        AccountFacts facts = facts(f, f.scope.policyVersion()).orElseThrow();
        assertEquals(f.golden.at("/expected/value/currentContract/contractId").asText(), facts.currentContract().contractId());
        assertEquals(f.golden.at("/expected/value/currentContract/model").asText(), facts.currentContract().model());
        assertEquals(f.golden.at("/expected/value/contextVersion").asText(), facts.factsVersion());
    }

    @Test
    void noCurrentCarAndAbsentAccountArePresentWithoutAContract() {
        GoldenFixture jordan = new GoldenFixture("jordan");
        assertNull(facts(jordan, jordan.scope.policyVersion()).orElseThrow().currentContract());
        GoldenFixture absent = new GoldenFixture("jordan-absent");
        AccountFacts none = facts(absent, absent.scope.policyVersion()).orElseThrow();
        assertNull(none.currentContract());
        assertNotNull(none.factsVersion());
    }

    @Test
    void refusalsAndMissingPolicyVersionAreUnavailable() {
        GoldenFixture bad = new GoldenFixture("sam-driver-invalid");
        assertTrue(facts(bad, bad.scope.policyVersion()).isEmpty());
        GoldenFixture paula = new GoldenFixture("paula");
        assertTrue(facts(paula, null).isEmpty());
        assertTrue(facts(paula, "other-version").isEmpty());
    }
}
