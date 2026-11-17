package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.brief.BriefAccountPort.AccountFacts;
import gcsp.api.persistence.Canonical;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The brief's account port reads the same projection the account endpoint serves. */
class BriefAccountAdapterTest {

    private static Optional<AccountFacts> facts(GoldenFixture f, String policyVersion) {
        AccountRecordsPort records = new AccountRecordsPort() {
            public SourceResult readEmployeeContract(AccountScope s) {
                return f.contractReader.apply(f.input);
            }

            public SourceResult readDrivers(AccountScope s) {
                return f.driverReader.apply(f.input);
            }

            public SourceResult readEmployment(String environmentId, String runId, String employeeId) {
                return f.employment;
            }
        };
        return new BriefAccountAdapter(f.service(records), records, Optional.ofNullable(policyVersion))
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
    void knownFactsAreTheSameReadsTheEditorNeeds() {
        GoldenFixture f = new GoldenFixture("paula");
        AccountFacts facts = facts(f, f.scope.policyVersion()).orElseThrow();
        var known = facts.known();
        JsonNode v = f.golden.at("/expected/value");
        assertEquals(v.get("account"), known.account());
        assertEquals(v.get("currentContract"), known.currentContract());
        assertEquals(v.get("drivers"), known.drivers());
        assertEquals(v.get("versions"), known.accountVersions());
        assertEquals(v.get("contextVersion").asText(), known.accountContextVersion());
        assertEquals("1", known.clockVersion());
        assertEquals(f.input.get("manualContext").get("employeeFacts"), known.employeeFacts());
        ObjectNode digest = GoldenFixture.JSON.createObjectNode();
        digest.set("driver", f.input.get("manualContext").get("source"));
        digest.set("recordSetId", f.input.get("manualContext").get("recordSetId"));
        digest.set("repositoryVersion", f.input.get("employeeVersion"));
        assertEquals(Canonical.digest(digest), known.providerFactsVersion());
        GoldenFixture absent = new GoldenFixture("jordan-absent");
        assertNull(facts(absent, absent.scope.policyVersion()).orElseThrow().known());
    }

    @Test
    void aDriverReadThatFailsIsUnavailable() {
        GoldenFixture f = new GoldenFixture("paula");
        f.driverReader = in -> SourceResult.unavailable("driver");
        assertTrue(facts(f, f.scope.policyVersion()).isEmpty());
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
