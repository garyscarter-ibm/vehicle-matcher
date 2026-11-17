package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.account.AccountScope;
import gcsp.api.account.ReturnsCurrentCarRelationships;
import gcsp.api.account.SourceResult;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** listForEmployee and the account adapter over native PostgreSQL; needs GCSP_TEST_DATABASE_URL. */
class CurrentCarListTest {

    static final Instant RETURNED_AT = Instant.parse("2026-11-07T10:30:00Z");
    static final Instant COLLECTED_AT = Instant.parse("2026-11-07T09:30:00Z");

    ReturnsFixture f;
    TransactionRunner runner;
    CurrentCarStore store;
    int seq;

    @BeforeEach
    void setUp() throws Exception {
        f = ReturnsFixture.create();
        runner = new TransactionRunner(f.pool());
        store = new CurrentCarStore(f.pool());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    void apply(CurrentCarEvent e, ReturnSource s) {
        Outcome o = runner.execute(f.ctx(), new Command("current-car", "cmd-" + (++seq), ReturnJson.JSON.createObjectNode().put("n", seq)),
                tx -> {
                    CurrentCarResult r = store.apply(tx, e, s);
                    return r instanceof CurrentCarResult.Refused x ? WorkResult.refuse(x.code(), x.message())
                            : WorkResult.ok(ReturnJson.JSON.createObjectNode().put("ok", true));
                });
        assertTrue(o instanceof Outcome.Committed, String.valueOf(o));
    }

    CurrentCarEvent returned(String order, String employee) {
        return new CurrentCarEvent(CurrentCarEvent.RETURN_CONFIRMED, order, employee, RETURNED_AT, "SYN-RET-AAAAAAAAAAAA",
                "contract-1", null, ReturnJson.JSON.createObjectNode().put("label", "BMW Park Lane"), "slot-ent-1",
                "SYN-APT-111111111111");
    }

    CurrentCarEvent collected(String order, String employee) {
        return new CurrentCarEvent(CurrentCarEvent.HANDOVER_COMPLETED, order, employee, COLLECTED_AT, "SYN-APT-222222222222",
                null, "WBA12345678901234", null, "slot-ent-1", "SYN-APT-222222222222");
    }

    AccountScope scope(String employee) {
        return new AccountScope(ReturnsFixture.ENV, "run-1", employee, employee, List.of("employee"), null, null, null, null, null);
    }

    @Test
    void listsOnlyTheEmployeesRecordedRelationshipsSortedByOrder() throws Exception {
        ReturnSource b = InMemoryReturnSource.replacement("order-b", "emp-1");
        ReturnSource a = InMemoryReturnSource.replacement("order-a", "emp-1");
        ReturnSource other = InMemoryReturnSource.replacement("order-c", "emp-2");
        apply(returned("order-b", "emp-1"), b);
        apply(returned("order-a", "emp-1"), a);
        apply(collected("order-a", "emp-1"), a);
        apply(returned("order-c", "emp-2"), other);

        List<CurrentCarView> list = store.listForEmployee(f.ctx(), "emp-1");
        assertEquals(List.of("order-a", "order-b"), list.stream().map(CurrentCarView::orderUuid).toList());
        assertEquals(2, list.get(0).changes().size());
        assertEquals("handover-completed", list.get(0).changes().get(0).type());
        assertEquals("return-confirmed", list.get(0).changes().get(1).type());
        assertEquals(1, list.get(1).changes().size());
        assertEquals(store.read(f.ctx(), "order-a", a).toJson(), list.get(0).toJson());
        assertEquals(store.read(f.ctx(), "order-b", b).toJson(), list.get(1).toJson());

        SourceResult result = new ReturnsCurrentCarRelationships(store).list(scope("emp-1"));
        assertTrue(result.isOk());
        assertEquals(2, result.value().size());
        JsonNode first = result.value().get(0);
        assertEquals("lifecycle.current-car.v1", first.get("contractVersion").asText());
        assertEquals("order-a", first.get("orderUuid").asText());
        assertEquals("order", first.get("currentCar").get("kind").asText());
        assertEquals(2, first.get("changes").size());
        assertEquals("order-b", result.value().get(1).get("orderUuid").asText());
    }

    @Test
    void anEmployeeWithNoRelationshipsGetsAnEmptyArray() throws Exception {
        apply(returned("order-c", "emp-2"), InMemoryReturnSource.replacement("order-c", "emp-2"));
        assertTrue(store.listForEmployee(f.ctx(), "emp-1").isEmpty());
        SourceResult result = new ReturnsCurrentCarRelationships(store).list(scope("emp-1"));
        assertTrue(result.isOk());
        assertTrue(result.value().isArray());
        assertEquals(0, result.value().size());
    }

    @Test
    void aFailingStoreIsAnExplicitUnavailable() throws Exception {
        f.close();
        SourceResult result = new ReturnsCurrentCarRelationships(store).list(scope("emp-1"));
        assertEquals(SourceResult.UNAVAILABLE, result.status());
        assertEquals("current-car-unavailable", result.code());
        f = null;
    }
}
