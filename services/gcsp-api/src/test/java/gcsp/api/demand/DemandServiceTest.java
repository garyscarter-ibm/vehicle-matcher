package gcsp.api.demand;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.demand.DemandFixture.Policy;
import gcsp.api.demand.OfferRecordsPort.DecisionRow;
import gcsp.api.demand.OfferRecordsPort.OfferRow;
import gcsp.api.demand.UnmetEvaluationPort.CarDecision;
import gcsp.api.demand.UnmetEvaluationPort.Gate;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

class DemandServiceTest {

    private static final String P = DemandFixture.POLICY;

    private static JsonNode num(Object v) {
        return DemandFixture.M.valueToTree(v);
    }

    private static JsonNode keyed(JsonNode list, String key) {
        for (JsonNode n : list) if (key.equals(n.path("key").asText(null))) return n;
        return null;
    }

    private static long exact(JsonNode aggregate) {
        JsonNode c = aggregate.path("count");
        assertEquals("exact", c.path("kind").asText(), aggregate.toString());
        return c.get("value").asLong();
    }

    /** At threshold 1 the only band is "fewer than 1", which is exactly zero. */
    private static long countOrZero(JsonNode aggregate) {
        JsonNode c = aggregate.path("count");
        if ("band".equals(c.path("kind").asText())) {
            assertEquals(1, c.get("fewerThan").asInt());
            return 0;
        }
        return exact(aggregate);
    }

    private static void walk(JsonNode n, Consumer<JsonNode> f) {
        f.accept(n);
        n.forEach(x -> walk(x, f));
    }

    private static String unavailableCode(DemandResult r) {
        DemandResult.Refusal f = (DemandResult.Refusal) r;
        assertEquals(503, f.http());
        assertTrue(f.retryable());
        return f.code();
    }

    private static List<String> employees(DemandFixture f, int n) throws Exception {
        List<String> ids = new ArrayList<>();
        for (int i = 1; i <= n; i++) {
            String id = "emp-secret-" + i;
            f.employee(id);
            ids.add(id);
        }
        return ids;
    }

    @Test
    void currentConfirmedBriefNotDraftOrHistoryDrivesDemand() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.employee("emp-secret-2");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", "petrol", 5, "G21 Touring"));
            f.brief("emp-secret-1", 2, DemandFixture.brief("suv", "diesel", 7, "G21 Touring"));
            f.draft("emp-secret-1", 1, DemandFixture.brief("coupe", "ev", 2, "i4"));
            f.draft("emp-secret-2", 1, DemandFixture.brief("coupe", "ev", 2, "i4"));
            ObjectNode v = f.ok();
            JsonNode d = v.get("demand");
            assertEquals(1, exact(d.get("activeBriefs")));
            assertEquals(1, exact(keyed(d.get("byModelLine"), "G21 Touring")));
            assertEquals(1, d.get("byModelLine").size());
            assertEquals(List.of("suv"), keys(d.get("byBody")));
            assertEquals(List.of("diesel"), keys(d.get("byFuel")));
            JsonNode seats = null;
            for (JsonNode e : d.get("essentials")) if ("seats".equals(e.get("field").asText())) seats = e;
            assertEquals(7, seats.get("value").asInt());
            assertEquals("gte", seats.get("operator").asText());
            assertEquals("confirmed", seats.get("state").asText());
            assertEquals("[2]", v.get("versions").get("brief").toString());
            assertEquals("expressed-saved-demand", v.get("basis").asText());
            assertEquals(7, v.get("versions").get("revision").asInt());
            assertEquals("2026-11-13T10:00:00.000Z", v.get("asOf").asText());
            assertTrue(f.offers.sawSnapshot);
            assertTrue(f.offers.seen.isClosed());
        }
    }

    private static List<String> keys(JsonNode list) {
        List<String> out = new ArrayList<>();
        list.forEach(n -> out.add(n.get("key").asText()));
        return out;
    }

    @Test
    void unspecifiedAndIndifferentStayExplicit() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            ObjectNode c = DemandFixture.brief(null, null, null, null);
            ((ObjectNode) c.get("preferences")).set("body", DemandFixture.pref("estate", 0));
            f.brief("emp-secret-1", 1, c);
            JsonNode d = f.ok().get("demand");
            assertEquals(List.of("unspecified"), keys(d.get("byBody")));
            assertEquals(List.of("unspecified"), keys(d.get("byFuel")));
            assertEquals(List.of("unspecified"), keys(d.get("byModelLine")));
        }
    }

    @Test
    void multipleChoiceCountsTheBriefOncePerValue() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.brief("emp-secret-1", 1, DemandFixture.brief(List.of("suv", "estate", "suv"), "petrol", null, null));
            JsonNode d = f.ok().get("demand");
            assertEquals(List.of("estate", "suv"), keys(d.get("byBody")));
            assertEquals(1, exact(d.get("activeBriefs")));
        }
    }

    @Test
    void unmetSeparatesNoStockNotVisibleAndEvaluatorGates() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", "petrol", 5, "G21 Touring"));
            JsonNode u = f.ok().get("demand").get("unmet");
            assertEquals(1, exact(u.get("total")));
            assertEquals(List.of("no-released-stock"), keys(u.get("byGate")));
            f.car("car-secret-1", "G21 Touring", "{\"companyIds\":[\"other\"],\"schemeIds\":[\"" + DemandFixture.SCHEME + "\"],\"employeeIds\":null}");
            assertEquals(List.of("stock-not-visible"), keys(f.ok().get("demand").get("unmet").get("byGate")));
            assertEquals(0, f.evaluator.calls.get());
            f.car("car-secret-2", "G21 Touring");
            f.evaluator.rule = b -> b.cars().stream().map(c -> new CarDecision(c.orderUuid(), "ineligible",
                    List.of(new Gate("fit", "seats")), List.of(new Gate("charging", null)))).toList();
            u = f.ok().get("demand").get("unmet");
            assertEquals(List.of("charging", "fit:seats"), keys(u.get("byGate")));
            assertEquals(1, f.evaluator.calls.get());
            assertEquals(1, f.evaluator.last.size());
            assertEquals(1, f.evaluator.last.get(0).cars().size());
            f.evaluator.rule = b -> b.cars().stream().map(c -> new CarDecision(c.orderUuid(), "eligible", List.of(), List.of())).toList();
            assertEquals(0, countOrZero(f.ok().get("demand").get("unmet").get("total")));
        }
    }

    @Test
    void employeeScopedVisibilityHidesCarsFromOthers() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.employee("emp-secret-2");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", null, null, null));
            f.brief("emp-secret-2", 1, DemandFixture.brief("estate", null, null, null));
            f.car("car-secret-1", "G21 Touring", "{\"companyIds\":[\"" + DemandFixture.COMPANY + "\"],\"schemeIds\":[\""
                    + DemandFixture.SCHEME + "\"],\"employeeIds\":[\"emp-secret-1\"]}");
            JsonNode u = f.ok().get("demand").get("unmet");
            assertEquals(1, exact(u.get("total")));
            assertEquals(List.of("stock-not-visible"), keys(u.get("byGate")));
            assertEquals(1, f.evaluator.last.size());
            assertEquals("emp-secret-1", f.evaluator.last.get(0).employeeId());
        }
    }

    @Test
    void heldAndAllocatedCarsAreNotAvailableAndEachCountsOnce() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", null, null, "G21 Touring"));
            f.car("car-secret-1", "G21 Touring");
            f.car("car-secret-2", "G21 Touring");
            f.car("car-secret-3", "G21 Touring");
            f.car("car-secret-4", "G21 Touring");
            f.update("UPDATE stock_cars SET attributes = jsonb_set(attributes, '{release,availability,availableUntil}', "
                    + "'\"2026-11-01T00:00:00.000Z\"') WHERE order_uuid = 'car-secret-4'");
            f.hold("hold-secret-1", "car-secret-2", "emp-secret-1", "cart", "active");
            f.hold("hold-secret-2", "car-secret-3", "emp-secret-1", "buddy-offer", "allocated");
            f.hold("hold-secret-3", "car-secret-3", "emp-secret-1", "cart", "released");
            JsonNode v = f.ok();
            JsonNode row = keyed(v.get("stock").get("byModelLine"), "G21 Touring");
            assertEquals(1, exact(row.get("released")));
            assertEquals(1, exact(row.get("held")));
            assertEquals(1, exact(row.get("allocated")));
            assertEquals(4, f.evaluator.last.get(0).cars().size());
            long available = f.evaluator.last.get(0).cars().stream().filter(c -> "available".equals(c.availabilityState())).count();
            assertEquals(1, available);
            assertEquals(3, exact(v.get("holds").get("total")));
            assertEquals(1, exact(v.get("holds").get("active")));
        }
    }

    @Test
    void stockModelFallsBackToEligibilityKeyThenUnconfirmed() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.car("car-secret-1", null);
            f.car("car-secret-2", null);
            f.update("UPDATE stock_cars SET attributes = jsonb_set(attributes, '{facts,facts,eligibilityModelKey}', "
                    + "'{\"status\":\"known\",\"value\":\"G20|Touring\"}') WHERE order_uuid = 'car-secret-2'");
            JsonNode s = f.ok().get("stock").get("byModelLine");
            assertEquals(List.of("G20", "unconfirmed"), keys(s));
        }
    }

    private void seedOutcomes(DemandFixture f) throws Exception {
        f.employee("emp-secret-1");
        f.brief("emp-secret-1", 1, DemandFixture.brief("estate", null, null, "G21 Touring"));
        f.brief("emp-secret-1", 2, DemandFixture.brief("estate", null, null, "G21 Touring"));
        for (int i = 1; i <= 6; i++) f.car("car-secret-" + i, "G21 Touring");
        f.hold("hold-secret-1", "car-secret-1", "emp-secret-1", "cart", "active");
        f.hold("hold-secret-2", "car-secret-2", "emp-secret-1", "buddy-offer", "allocated");
        f.offers.offers.add(new OfferRow("offer-secret-1", "emp-secret-1", "car-secret-1", "hold-secret-1", "accepted", 1L, P));
        f.offers.offers.add(new OfferRow("offer-secret-2", "emp-secret-1", "car-secret-3", null, "open", 1L, P));
        f.offers.offers.add(new OfferRow("offer-secret-3", "emp-secret-1", "car-secret-4", null, "declined", 1L, P));
        f.offers.offers.add(new OfferRow("offer-secret-4", "emp-secret-1", "car-secret-5", null, "expired", 1L, P));
        f.offers.offers.add(new OfferRow("offer-secret-5", "emp-secret-1", "car-secret-2", "hold-secret-2", "open", 1L, P));
        f.offers.decisions.add(new DecisionRow("offer-secret-2", "emp-secret-1", "decline", "price", 2L, P));
        f.offers.decisions.add(new DecisionRow("offer-secret-3", "emp-secret-1", "decline", "not-a-reason", 1L, P));
    }

    @Test
    void offersDecisionsAndHoldsDriveOutcomesWithTypedDeclinesAndVersions() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            seedOutcomes(f);
            ObjectNode v = f.ok();
            JsonNode o = v.get("offers");
            assertEquals(5, exact(o.get("made")));
            assertEquals(1, exact(o.get("accepted")));
            assertEquals(2, exact(o.get("declined")));
            assertEquals(1, exact(o.get("expired")));
            assertEquals(1, exact(o.get("selected")));
            assertEquals(1, exact(keyed(o.get("declinedByReason"), "price")));
            assertEquals(1, exact(keyed(o.get("declinedByReason"), "unclassified")));
            assertEquals("[1,2]", o.get("declined").get("versions").get("brief").toString().replace(" ", ""));
            JsonNode h = v.get("holds");
            assertEquals(2, exact(h.get("total")));
            assertEquals(1, exact(h.get("active")));
            assertEquals(1, exact(keyed(h.get("byType"), "cart")));
            assertEquals(1, exact(keyed(h.get("byType"), "buddy-offer")));
            assertEquals(1, exact(keyed(h.get("byState"), "allocated")));
            assertEquals("[1]", h.get("total").get("versions").get("brief").toString());
            assertEquals("[\"" + P + "\"]", h.get("total").get("versions").get("policy").toString());
        }
    }

    @Test
    void reasonAddedToPolicyBecomesACategoryWithoutCodeChange() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", null, null, null));
            f.offers.offers.add(new OfferRow("offer-secret-1", "emp-secret-1", "car-secret-1", null, "declined", 1L, P));
            f.offers.decisions.add(new DecisionRow("offer-secret-1", "emp-secret-1", "decline", "safety", 1L, P));
            f.car("car-secret-1", null);
            assertEquals(List.of("unclassified"), keys(f.ok().get("offers").get("declinedByReason")));
            List<String> more = new ArrayList<>(DemandFixture.REASONS);
            more.add("safety");
            f.policy.declineReasons = Policy.reasons(more);
            assertEquals(List.of("safety"), keys(f.ok().get("offers").get("declinedByReason")));
        }
    }

    @Test
    void allBelowThresholdBandsAndNoIdentifyingFieldsAppear() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            seedOutcomes(f);
            f.offers.offers.remove(f.offers.offers.size() - 1);
            f.policy.threshold = num(5);
            ObjectNode v = f.ok();
            String text = v.toString();
            for (String forbidden : List.of("secret", "PRIVATE", "employeeId", "orderUuid", "offerId", "holdId", "name")) {
                assertFalse(text.contains(forbidden), forbidden);
            }
            JsonNode top = v.get("versions");
            assertEquals("band", v.get("demand").get("activeBriefs").get("count").get("kind").asText());
            assertEquals(5, v.get("demand").get("activeBriefs").get("count").get("fewerThan").asInt());
            assertFalse(v.get("privacy").get("withheld").asBoolean());
            walk(v, n -> {
                if (n.has("count") && "band".equals(n.get("count").path("kind").asText())) {
                    assertFalse(n.get("count").has("value"));
                    assertEquals(top.get("brief"), n.get("versions").get("brief"));
                    assertEquals(top.get("policy"), n.get("versions").get("policy"));
                }
            });
        }
    }

    @Test
    void thresholdChangesEveryProjectionConsistently() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            seedOutcomes(f);
            ObjectNode one = f.ok();
            f.policy.threshold = num(5);
            ObjectNode five = f.ok();
            assertNotEquals(one.get("projectionVersion"), five.get("projectionVersion"));
            assertEquals(1, one.get("privacy").get("threshold").asInt());
            assertEquals(5, five.get("privacy").get("threshold").asInt());
            assertEquals("greg.demand.smallCountThreshold", five.get("privacy").get("thresholdKey").asText());
            compare(one.get("demand"), five.get("demand"));
            compare(one.get("holds"), five.get("holds"));
            compare(one.get("offers"), five.get("offers"));
            compare(one.get("stock"), five.get("stock"));
        }
    }

    private static void compare(JsonNode one, JsonNode five) {
        if (five.isObject() && five.has("kind")) {
            String k = five.get("kind").asText();
            if ("exact".equals(k)) assertEquals(one, five);
            else if ("exact".equals(one.get("kind").asText())) {
                long v = one.get("value").asLong();
                if ("band".equals(k) && five.has("fewerThan")) assertTrue(v < 5);
                else assertTrue(v >= 5);
            }
            return;
        }
        if (five.isObject()) {
            assertEquals(one.size(), five.size());
            five.fieldNames().forEachRemaining(n -> {
                if (!"versions".equals(n)) compare(one.get(n), five.get(n));
            });
        } else if (five.isArray()) {
            assertEquals(one.size(), five.size());
            for (int i = 0; i < five.size(); i++) compare(one.get(i), five.get(i));
        } else assertEquals(one, five);
    }

    @Test
    void unusableThresholdOrVersionIsPrivacyPolicyUnavailable() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", null, null, null));
            for (JsonNode bad : new JsonNode[] {num(0), num(-1), num(1.5), num("5"), num(3000000000L), null, num(null)}) {
                f.policy.threshold = bad;
                assertEquals("privacy-policy-unavailable", unavailableCode(f.read()), String.valueOf(bad));
            }
            f.policy.threshold = num(5);
            f.ok();
            f.policy.version = "other-policy";
            assertEquals("privacy-policy-unavailable", unavailableCode(f.read()));
            f.policy.version = P;
            f.policy.absent = true;
            assertEquals("privacy-policy-unavailable", unavailableCode(f.read()));
        }
    }

    @Test
    void invalidDeclinePolicyIsUnavailable() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", null, null, null));
            JsonNode[] bad = {null, DemandFixture.json("{\"schemaVersion\":2,\"reasons\":[{\"code\":\"a\"}]}"),
                DemandFixture.json("{\"schemaVersion\":1,\"reasons\":[]}"),
                DemandFixture.json("{\"schemaVersion\":1,\"reasons\":[{\"code\":\"a\"},{\"code\":\"a\"}]}"),
                DemandFixture.json("{\"schemaVersion\":1,\"reasons\":[{\"code\":\"\"}]}"),
                DemandFixture.json("{\"schemaVersion\":1,\"reasons\":[{\"code\":5}]}"),
                DemandFixture.json("{\"schemaVersion\":1}")};
            for (JsonNode b : bad) {
                f.policy.declineReasons = b;
                assertEquals("privacy-policy-unavailable", unavailableCode(f.read()), String.valueOf(b));
            }
            f.policy.declineReasons = Policy.reasons(DemandFixture.REASONS);
            f.policy.exclusion = num("untilNever");
            assertEquals("privacy-policy-unavailable", unavailableCode(f.read()));
        }
    }

    @Test
    void declinedCarStaysBlockedUntilARelevantConfirmedBriefChange() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.car("car-secret-1", "G21 Touring");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", "petrol", 5, "G21 Touring"));
            f.offers.offers.add(new OfferRow("offer-secret-1", "emp-secret-1", "car-secret-1", null, "declined", 1L, P));
            f.offers.decisions.add(new DecisionRow("offer-secret-1", "emp-secret-1", "decline", "price", 1L, P));
            JsonNode u = f.ok().get("demand").get("unmet");
            assertEquals(1, exact(u.get("total")));
            assertEquals(List.of("declined-unchanged"), keys(u.get("byGate")));
            ObjectNode paused = DemandFixture.brief("estate", "petrol", 5, "G21 Touring");
            paused.put("paused", true);
            f.brief("emp-secret-1", 2, paused);
            assertEquals(1, exact(f.ok().get("demand").get("unmet").get("total")));
            f.brief("emp-secret-1", 3, DemandFixture.brief("estate", "petrol", 7, "G21 Touring"));
            assertEquals(0, countOrZero(f.ok().get("demand").get("unmet").get("total")));
        }
    }

    @Test
    void changedInputsChangeProjectionVersionAndFigures() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.employee("emp-secret-2");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", null, null, null));
            ObjectNode a = f.ok();
            assertEquals(a.get("projectionVersion"), f.ok().get("projectionVersion"));
            f.brief("emp-secret-2", 1, DemandFixture.brief("estate", null, null, null));
            ObjectNode b = f.ok();
            assertNotEquals(a.get("projectionVersion"), b.get("projectionVersion"));
            assertEquals(2, exact(b.get("demand").get("activeBriefs")));
            f.car("car-secret-1", "G21 Touring");
            ObjectNode c = f.ok();
            assertNotEquals(b.get("projectionVersion"), c.get("projectionVersion"));
            f.hold("hold-secret-1", "car-secret-1", "emp-secret-1", "cart", "active");
            ObjectNode d = f.ok();
            assertNotEquals(c.get("projectionVersion"), d.get("projectionVersion"));
            assertEquals(1, exact(d.get("holds").get("total")));
            f.update("UPDATE runs SET revision = 8 WHERE run_id = ?", DemandFixture.RUN);
            assertNotEquals(d.get("projectionVersion"), f.ok().get("projectionVersion"));
        }
    }

    @Test
    void retiredOrMissingRunIsStale() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            DemandResult.Refusal missing = (DemandResult.Refusal) f.service.read(new DemandScope(DemandFixture.ENV, "no-run", P));
            assertEquals(409, missing.http());
            assertEquals("stale-run", missing.code());
            assertFalse(missing.retryable());
            f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = ?", DemandFixture.RUN);
            assertEquals("stale-run", ((DemandResult.Refusal) f.read()).code());
            assertEquals("stale-run", ((DemandResult.Refusal) f.read()).body().get("status").asText());
        }
    }

    @Test
    void unconfiguredPortsAreTruthfulUnavailable() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", null, null, null));
            f.car("car-secret-1", "G21 Touring");
            DemandService noPolicy = f.service(new DemandDefaults.UnconfiguredPolicy(), f.evaluator, f.offers);
            assertEquals("privacy-policy-unavailable", unavailableCode(noPolicy.read(DemandFixture.SCOPE)));
            DemandService noEvaluator = f.service(f.policy, new DemandDefaults.UnconfiguredEvaluation(), f.offers);
            assertEquals("evaluation-unavailable", unavailableCode(noEvaluator.read(DemandFixture.SCOPE)));
            DemandService noOffers = f.service(f.policy, f.evaluator, new DemandDefaults.UnconfiguredOffers());
            assertEquals("source-invalid", unavailableCode(noOffers.read(DemandFixture.SCOPE)));
            f.evaluator.unavailable = true;
            assertEquals("evaluation-unavailable", unavailableCode(f.read()));
            f.evaluator.unavailable = false;
            f.evaluator.rule = b -> List.of();
            assertEquals("evaluation-unavailable", unavailableCode(f.read()));
        }
    }

    @Test
    void briefWithoutAnOwnerIsUnavailable() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-secret-1");
            f.brief("emp-secret-1", 1, DemandFixture.brief("estate", null, null, null));
            f.update("UPDATE employees SET attributes = '{\"companyId\":5}'::jsonb WHERE employee_id = 'emp-secret-1'");
            assertEquals("brief-owner-unavailable", unavailableCode(f.read()));
        }
    }

    @Test
    void sourceStatusFollowsTheLatestTick() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            assertEquals("not-checked", f.ok().get("stock").get("source").get("status").asText());
            f.tick("t1", 1, "pending", null);
            assertEquals("delayed", f.ok().get("stock").get("source").get("status").asText());
            f.tick("t2", 2, "completed", "{\"status\":\"ok\"}");
            assertEquals("{\"status\":\"ok\"}", f.ok().get("stock").get("source").toString());
            f.tick("t3", 3, "completed", "{\"status\":\"unavailable\",\"code\":\"stock-source-stale\"}");
            assertEquals("{\"status\":\"unavailable\",\"reason\":\"stale\"}", f.ok().get("stock").get("source").toString());
            f.tick("t4", 4, "refused", "{\"status\":\"unavailable\",\"code\":\"other\"}");
            assertEquals("{\"status\":\"unavailable\"}", f.ok().get("stock").get("source").toString());
            f.update("DROP TABLE supply_release_ticks CASCADE");
            ObjectNode v = f.ok();
            assertEquals("evidence-unavailable", v.get("stock").get("source").get("status").asText());
            assertNull(v.get("stock").get("source").get("reason"));
        }
    }

    /** With every published cell and the parent, each withheld partition cell must keep at least two feasible values. */
    private static void assertUnsolvable(int n, JsonNode parent, List<JsonNode> cells, int minimum) {
        if (!"exact".equals(parent.get("count").get("kind").asText())) return;
        long rest = parent.get("count").get("value").asLong();
        int small = 0;
        int atLeast = 0;
        for (JsonNode c : cells) {
            JsonNode k = c.get("count");
            switch (k.get("kind").asText()) {
                case "exact" -> rest -= k.get("value").asLong();
                case "band" -> {
                    if (k.has("fewerThan")) small++;
                    else atLeast++;
                }
                default -> throw new AssertionError(k.toString());
            }
        }
        if (small == 0) {
            assertNotEquals(1, atLeast, "a lone withheld cell is the difference of the parent and the rest");
            return;
        }
        int feasible = 0;
        for (int v = minimum; v < n; v++) {
            long r = rest - v;
            long lo = (long) (small - 1) * minimum + (long) atLeast * n;
            boolean ok = r >= lo && (atLeast > 0 || r <= (long) (small - 1) * (n - 1));
            if (ok) feasible++;
        }
        assertTrue(feasible >= 2, "a small cell is solvable: " + parent + " " + cells);
    }

    @Test
    void noSmallCellCanBeSolvedFromTheOthersAndTheParent() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            List<String> ids = employees(f, 12);
            for (int i = 0; i < ids.size(); i++) {
                f.brief(ids.get(i), 1, DemandFixture.brief("estate", "petrol", null, i < 2 ? "A" : "B"));
            }
            for (int i = 1; i <= 8; i++) f.car("car-secret-" + i, "B");
            for (int i = 1; i <= 5; i++) f.hold("hold-secret-" + i, "car-secret-" + i, ids.get(i), "cart", "active");
            for (int i = 6; i <= 8; i++) f.hold("hold-secret-" + i, "car-secret-" + i, ids.get(i), i == 8 ? "buddy-offer" : "cart", "allocated");
            String[] states = {"accepted", "accepted", "declined", "declined", "declined", "expired", "expired"};
            for (int i = 0; i < states.length; i++) {
                f.offers.offers.add(new OfferRow("offer-secret-" + i, ids.get(i), "car-secret-1", null, states[i], 1L, P));
            }
            f.policy.threshold = num(5);
            ObjectNode v = f.ok();
            JsonNode d = v.get("demand");
            assertUnsolvable(5, d.get("activeBriefs"), list(d.get("byModelLine")), 1);
            JsonNode h = v.get("holds");
            assertUnsolvable(5, h.get("total"), list(h.get("byState")), 1);
            assertUnsolvable(5, h.get("total"), list(h.get("byType")), 1);
            JsonNode o = v.get("offers");
            assertUnsolvable(5, o.get("made"), List.of(o.get("accepted"), o.get("declined"), o.get("expired"), o.get("selected")), 0);
            assertUnsolvable(5, o.get("declined"), list(o.get("declinedByReason")), 1);
            // A cover child that is small needs a withheld sibling or a withheld parent.
            for (String field : List.of("byBody", "byFuel")) {
                boolean parentExact = "exact".equals(d.get("activeBriefs").get("count").get("kind").asText());
                boolean anySmall = false;
                boolean anyAtLeast = false;
                for (JsonNode c : d.get(field)) {
                    anySmall |= c.get("count").has("fewerThan");
                    anyAtLeast |= c.get("count").has("atLeast");
                }
                if (parentExact && anySmall) assertTrue(anyAtLeast, field);
            }
            assertTrue(v.get("privacy").get("withheld").asBoolean());
        }
    }

    private static List<JsonNode> list(JsonNode array) {
        List<JsonNode> out = new ArrayList<>();
        array.forEach(out::add);
        return out;
    }
}
