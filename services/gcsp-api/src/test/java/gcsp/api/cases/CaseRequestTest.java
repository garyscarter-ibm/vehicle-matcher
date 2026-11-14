package gcsp.api.cases;

import static gcsp.api.cases.CaseHarness.move;
import static gcsp.api.cases.CaseHarness.ok;
import static gcsp.api.cases.CaseHarness.open;
import static gcsp.api.cases.CaseHarness.refused;
import static gcsp.api.cases.CaseHarness.request;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The employee's help request: opening, appending, replay, refusals and the one-active-case guarantee. */
class CaseRequestTest {

    CaseFixture f;

    @BeforeEach
    void setUp() throws SQLException {
        f = CaseFixture.create();
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    @Test
    void requestOpensTheOwnedCaseWithTheNodeFixtureValues() throws SQLException {
        JsonNode r = ok(f.service.requestHelp(f.paula, request("help", "My replacement may miss my contract end.")));
        JsonNode c = r.get("case");
        assertEquals("open", c.get("status").asText());
        assertEquals("scheme-team", c.get("owner").get("role").asText());
        assertEquals("Scheme team", c.get("owner").get("name").asText());
        assertEquals("My replacement may miss my contract end.", c.get("reason").asText());
        assertEquals("Scheme team to review your renewal and contact you.", c.get("nextAction").asText());
        assertEquals("2026-11-06T09:00:00.000Z", c.get("dueAt").asText());
        assertEquals("2026-11-05T09:00:00.000Z", c.get("openedAt").asText());
        assertEquals("2026-11-05T09:00:00.000Z", c.get("lastUpdatedAt").asText());
        assertEquals("2026-12-01", c.get("renewalDeadline").asText());
        assertEquals("supplied-demo-fact", c.get("renewalDeadlineState").asText());
        assertEquals("renewal:emp-paula", c.get("renewalId").asText());
        assertTrue(c.get("remedy").isNull());
        assertTrue(c.get("fictional").booleanValue());
        assertEquals("run-1", c.get("runId").asText());
        assertEquals(1, c.get("version").asLong());
        assertEquals("employee-request", c.get("trigger").get("type").asText());
        assertEquals("help", c.get("trigger").get("requestId").asText());
        assertTrue(c.get("caseId").asText().matches("renewal-[0-9a-f]{40}"));
        JsonNode h = c.get("history").get(0);
        assertEquals("employee", h.get("actorRole").asText());
        assertEquals("principal-paula", h.get("actorId").asText());
        assertEquals("open", h.get("status").asText());
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'renewal-case-update'"));
        assertEquals(1, f.count("SELECT revision FROM runs"));
    }

    @Test
    void unknownDeadlineNeedsConfirmation() {
        f.account.set("emp-paula", "Paula", "renewal:emp-paula", null);
        JsonNode c = open(f);
        assertTrue(c.get("renewalDeadline").isNull());
        assertEquals("needs-confirmation", c.get("renewalDeadlineState").asText());
        f.account.set("emp-alex", "Alex", "renewal:emp-alex", "not-a-date");
        JsonNode a = ok(f.service.requestHelp(f.alex, request("x", "Late"))).get("case");
        assertEquals("needs-confirmation", a.get("renewalDeadlineState").asText());
    }

    @Test
    void secondRequestAppendsToTheSameActiveCase() throws SQLException {
        JsonNode first = open(f);
        JsonNode second = ok(f.service.requestHelp(f.paula, request("again", "Still no news."))).get("case");
        assertEquals(first.get("caseId"), second.get("caseId"));
        assertEquals(2, second.get("version").asLong());
        assertEquals(2, second.get("history").size());
        assertEquals("employee-request", second.get("history").get(1).get("trigger").get("type").asText());
        assertEquals("again", second.get("history").get(1).get("trigger").get("requestId").asText());
        assertEquals("Still no news.", second.get("history").get(1).get("reason").asText());
        assertEquals(1, f.count("SELECT count(*) FROM renewal_cases"));
        assertEquals(2, f.count("SELECT count(*) FROM outbox_events"));
        JsonNode update = f.service.readOwn(f.paula, Optional.empty()) instanceof CaseResult.Ok o ? o.value() : null;
        assertEquals(1, update.get("cases").size());
    }

    @Test
    void replayReturnsTheOriginalResultAndChangedInputConflicts() throws SQLException {
        ObjectNode cmd = request("same", "My replacement may miss my contract end.");
        JsonNode first = ok(f.service.requestHelp(f.paula, cmd));
        List<Long> before = f.snapshot();
        CaseResult again = f.service.requestHelp(f.paula, cmd);
        assertTrue(assertInstanceOf(CaseResult.Ok.class, again).replayed());
        assertEquals(gcsp.api.persistence.Canonical.json(first), gcsp.api.persistence.Canonical.json(((CaseResult.Ok) again).value()));
        refused(f.service.requestHelp(f.paula, request("same", "A different reason")), 409, "command-input-changed");
        assertEquals(before, f.snapshot());
    }

    @Test
    void invalidInputsAndUnavailableContextAreRefusedWithoutWrites() throws SQLException {
        List<Long> before = f.snapshot();
        refused(f.service.requestHelp(f.paula, request("", "x")), 400, "invalid-case-command");
        refused(f.service.requestHelp(f.paula, request("c", "")), 400, "invalid-case-command");
        refused(f.service.requestHelp(f.paula, request("c", "x".repeat(2001))), 400, "invalid-case-command");
        refused(f.service.requestHelp(f.paula, request("c", "x").put("extra", true)), 400, "invalid-case-command");
        f.account.set("emp-paula", "Paula", null, "2026-12-01");
        CaseResult.Refusal missing = refused(f.service.requestHelp(f.paula, request("m", "x")), 400, "renewal-context-required");
        assertEquals("renewalId", missing.extra().get("reasons").get(0).get("field").asText());
        assertEquals("The actual renewal has not been supplied. Ask the scheme team to check your contract.",
                missing.extra().get("reasons").get(0).get("reason").asText());
        assertEquals("review-and-retry", missing.extra().get("action").asText());
        f.account.unavailable = true;
        refused(f.service.requestHelp(f.paula, request("u", "x")), 503, "case-unavailable");
        f.account.unavailable = false;
        f.policy.missing = true;
        refused(f.service.requestHelp(f.paula, request("p", "x")), 503, "case-unavailable");
        f.policy.missing = false;
        assertEquals(before, f.snapshot());
    }

    @Test
    void invalidPolicyRowsMakeTheServiceUnavailable() {
        com.fasterxml.jackson.databind.node.JsonNodeFactory n = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance;
        f.policy.set("renewalCase.owner.role", n.textNode("somebody-else"));
        refused(f.service.requestHelp(f.paula, request("a", "x")), 503, "case-unavailable");
        f.policy.set("renewalCase.owner.role", n.textNode("scheme-team"));
        f.policy.set("renewalCase.response.dueHours", n.numberNode(0));
        refused(f.service.requestHelp(f.paula, request("b", "x")), 503, "case-unavailable");
        f.policy.set("renewalCase.response.dueHours", n.numberNode(24));
        f.policy.set("renewalCase.deadline.enabled", n.textNode("yes"));
        refused(f.service.requestHelp(f.paula, request("c", "x")), 503, "case-unavailable");
        f.policy.set("renewalCase.deadline.enabled", n.booleanNode(true));
        f.policy.edit("renewalCase.extension.permitted", row -> row.put("status", "draft"));
        refused(f.service.requestHelp(f.paula, request("d", "x")), 503, "case-unavailable");
        f.policy.edit("renewalCase.extension.permitted", row -> row.put("status", "assumed").remove("basis"));
        refused(f.service.requestHelp(f.paula, request("e", "x")), 503, "case-unavailable");
        f.policy.edit("renewalCase.extension.permitted", row -> row.put("policyVersion", "other"));
        refused(f.service.requestHelp(f.paula, request("f", "x")), 503, "case-unavailable");
        f.policy.set("renewalCase.lifecycle.eventTypes", CaseJson.arr().add("a").add("a"));
        f.policy.edit("renewalCase.extension.permitted", row -> {});
        refused(f.service.requestHelp(f.paula, request("g", "x")), 503, "case-unavailable");
        f.policy.set("renewalCase.lifecycle.eventTypes", CaseJson.arr().add("a"));
        f.policy.set("renewalCase.lifecycle.exceptionCopy", CaseJson.obj().set("a", CaseJson.obj().put("label", "x".repeat(121)).put("reason", "r")));
        refused(f.service.requestHelp(f.paula, request("h", "x")), 503, "case-unavailable");
        f.policy.set("renewalCase.lifecycle.exceptionCopy", CaseJson.obj());
        ok(f.service.requestHelp(f.paula, request("i", "x")));
    }

    @Test
    void aNewRequestAfterResolutionOrClosureOpensANewCase() throws SQLException {
        JsonNode c = open(f);
        c = move(f, c, "in-progress");
        c = move(f, c, "resolved");
        JsonNode next = ok(f.service.requestHelp(f.paula, request("after", "It happened again."))).get("case");
        assertNotEquals(c.get("caseId"), next.get("caseId"));
        assertEquals("open", next.get("status").asText());
        assertEquals(2, f.count("SELECT count(*) FROM renewal_cases"));
        move(f, c, "closed");
        move(f, next, "closed");
        JsonNode third = ok(f.service.requestHelp(f.paula, request("third", "And again."))).get("case");
        assertEquals("open", third.get("status").asText());
        assertEquals(3, f.count("SELECT count(*) FROM renewal_cases"));
        assertEquals(1, f.count("SELECT count(*) FROM renewal_cases WHERE status IN ('open','in-progress','remedy-proposed')"));
    }

    @Test
    void concurrentRequestsEndWithOneActiveCaseAndTwoHistoryEntries() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 5; round++) {
                try (CaseFixture g = CaseFixture.create()) {
                    CaseService a = g.newService(g.pool());
                    CaseService b = g.newService(g.pool());
                    CountDownLatch go = new CountDownLatch(1);
                    List<Future<CaseResult>> results = new ArrayList<>();
                    for (CaseService s : List.of(a, b)) {
                        String id = s == a ? "one" : "two";
                        Callable<CaseResult> call = () -> {
                            go.await();
                            return s.requestHelp(g.paula, request(id, "Request " + id));
                        };
                        results.add(pool.submit(call));
                    }
                    go.countDown();
                    for (Future<CaseResult> r : results) assertInstanceOf(CaseResult.Ok.class, r.get(30, TimeUnit.SECONDS));
                    assertEquals(1, g.count("SELECT count(*) FROM renewal_cases"));
                    assertEquals(2, g.count("SELECT count(*) FROM renewal_case_history"));
                    assertEquals(2, g.count("SELECT count(*) FROM outbox_events"));
                    assertEquals(2, g.count("SELECT revision FROM runs"));
                    assertEquals(2, g.count("SELECT version FROM renewal_cases"));
                }
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
