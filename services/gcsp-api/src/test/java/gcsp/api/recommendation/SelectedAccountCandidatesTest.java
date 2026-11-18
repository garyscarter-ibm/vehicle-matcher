package gcsp.api.recommendation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.SourceResult;
import gcsp.api.allocation.EligibleCandidates.Evaluated;
import gcsp.api.allocation.EligibleCandidates.Request;
import gcsp.api.allocation.EligibleCandidates.Subject;
import gcsp.api.allocation.EligibleCandidates.Unavailable;
import java.util.ArrayList;
import java.util.List;
import java.util.function.UnaryOperator;
import org.junit.jupiter.api.Test;

/** The selected account records, not the caller's accountRecord, decide the canonical calculation's inputs. */
class SelectedAccountCandidatesTest {

    @Test
    void selectedRecordsReproduceTheCanonicalResultAndReceiveTheTrustedScope() throws Exception {
        Request request = RecommendationCandidatesTest.request();
        List<AccountScope> seen = new ArrayList<>();
        Evaluated selected = evaluated(new SelectedAccountCandidates(calculation(), recording(seen)), request);
        assertEquals(assertInstanceOf(Evaluated.class, calculation().evaluate(request)), selected);
        assertEquals(2, seen.size());
        AccountScope scope = seen.get(0);
        assertEquals(List.of(SourceFixture.ENV, SourceFixture.RUN, "employee-paula", "slot-paula", "gcsp-policy-v1"), List.of(
                scope.environmentId(), scope.runId(), scope.employeeId(), scope.entitlementSlotId(), scope.policyVersion()));
        JsonNode attributes = request.subject().employeeAttributes();
        assertEquals(attributes.get("companyId").asText(), scope.companyId());
        assertEquals(attributes.get("schemeId").asText(), scope.schemeId());
        assertEquals(attributes.get("gradeId").asText(), scope.gradeId());
        assertEquals(scope, seen.get(1));
    }

    @Test
    void selectedDriverFactsWinOverConflictingCallerAccountData() throws Exception {
        Request callerBlocked = RecommendationCandidatesTest.request();
        driverEligible((ObjectNode) callerBlocked.subject().accountRecord(), false);
        assertEquals("ineligible", evaluated(calculation(), callerBlocked).decisions().get(0).gateStatus());
        assertEquals("eligible", evaluated(selected(UnaryOperator.identity()), callerBlocked).decisions().get(0).gateStatus());

        Request callerMissing = withAccount(RecommendationCandidatesTest.request(), NullNode.instance);
        assertEquals("eligible", evaluated(selected(UnaryOperator.identity()), callerMissing).decisions().get(0).gateStatus());

        SelectedAccountCandidates selectedBlocked = selected(drivers -> {
            driverEligible(drivers, false);
            return drivers;
        });
        var blocked = evaluated(selectedBlocked, RecommendationCandidatesTest.request()).decisions().get(0);
        assertEquals("ineligible", blocked.gateStatus());
        assertTrue(hasCode(blocked.blockers(), "driver-ineligible"));
    }

    @Test
    void anUnavailableOrMissingSelectedSourceRefusesDespiteACompleteCallerRecord() throws Exception {
        Request request = RecommendationCandidatesTest.request();
        AccountRecordsPort paula = SourceFixture.records("paula");
        for (AccountRecordsPort port : List.of(
                ports(s -> SourceResult.unavailable("account-provider-not-configured"), paula::readDrivers),
                ports(s -> SourceResult.notFound(), paula::readDrivers),
                ports(paula::readEmployeeContract, s -> SourceResult.unavailable("repository-unavailable")),
                ports(s -> {
                    throw new IllegalStateException("source failed");
                }, paula::readDrivers))) {
            Unavailable refused = assertInstanceOf(Unavailable.class,
                    new SelectedAccountCandidates(calculation(), port).evaluate(request));
            assertEquals(SelectedAccountCandidates.UNAVAILABLE, refused.code());
        }
    }

    @Test
    void crossScopeOrMismatchedReadsAreInconsistentNotMerged() throws Exception {
        Request request = RecommendationCandidatesTest.request();
        List<UnaryOperator<ObjectNode>> faults = List.of(
                d -> d.put("recordSetId", "manual:employee-paula:v2"),
                d -> d.put("repositoryVersion", 4),
                d -> d.put("runId", "another-run"),
                d -> d.put("employeeId", "employee-other"),
                d -> {
                    d.remove("employeeFacts");
                    return d;
                });
        for (UnaryOperator<ObjectNode> fault : faults) {
            Unavailable refused = assertInstanceOf(Unavailable.class, selected(fault).evaluate(request));
            assertEquals(SelectedAccountCandidates.INCONSISTENT, refused.code());
        }
    }

    private static SelectedAccountCandidates selected(UnaryOperator<ObjectNode> drivers) throws Exception {
        AccountRecordsPort paula = SourceFixture.records("paula");
        return new SelectedAccountCandidates(calculation(), ports(paula::readEmployeeContract,
                s -> SourceResult.ok(drivers.apply((ObjectNode) paula.readDrivers(s).value().deepCopy()))));
    }

    private static AccountRecordsPort recording(List<AccountScope> seen) throws Exception {
        AccountRecordsPort paula = SourceFixture.records("paula");
        return ports(s -> {
            seen.add(s);
            return paula.readEmployeeContract(s);
        }, s -> {
            seen.add(s);
            return paula.readDrivers(s);
        });
    }

    private static AccountRecordsPort ports(Read contract, Read drivers) {
        return new AccountRecordsPort() {
            public SourceResult readEmployeeContract(AccountScope scope) {
                return contract.read(scope);
            }

            public SourceResult readDrivers(AccountScope scope) {
                return drivers.read(scope);
            }

            public SourceResult readEmployment(String environmentId, String runId, String employeeId) {
                throw new AssertionError("candidates must not read employment");
            }
        };
    }

    private interface Read {
        SourceResult read(AccountScope scope);
    }

    private static RecommendationCandidates calculation() {
        return new RecommendationCandidates(SourceFixture.policy());
    }

    private static Evaluated evaluated(gcsp.api.allocation.EligibleCandidates candidates, Request request) {
        return assertInstanceOf(Evaluated.class, candidates.evaluate(request));
    }

    private static Request withAccount(Request r, JsonNode account) {
        Subject s = r.subject();
        return new Request(r.environmentId(), r.runId(), r.policyVersion(), r.asOf(), r.clockVersion(), new Subject(
                s.employeeId(), s.slotId(), s.employeeVersion(), s.employeeAttributes(), account, s.briefVersion(),
                s.briefContent()), r.cars());
    }

    private static void driverEligible(ObjectNode record, boolean value) {
        ((ObjectNode) record.path("drivers").get(0).get("eligible")).put("value", value);
    }

    private static boolean hasCode(JsonNode rows, String code) {
        for (JsonNode row : rows) if (code.equals(row.path("code").asText())) return true;
        return false;
    }
}
