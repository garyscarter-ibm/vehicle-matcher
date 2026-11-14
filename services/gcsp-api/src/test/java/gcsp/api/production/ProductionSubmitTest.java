package gcsp.api.production;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.production.PlanSnapshotPort.Unavailable;
import gcsp.api.production.ProductionFixture.Wrapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Validation, plan checks, replay, refusals and the provider modes: what is written and what is never written. */
class ProductionSubmitTest {

    @Test
    void happyPathStoresIntentThenRequestedAndOneProviderOrderPerLine() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            ProductionResult r = f.submit("cmd-1");
            ProductionResult.Ok ok = assertInstanceOf(ProductionResult.Ok.class, r);
            assertEquals(false, ok.replayed());
            JsonNode v = ok.value();
            assertEquals("plan-1", v.get("planId").asText());
            assertEquals("Requested. Production has not confirmed any of this yet.", v.get("message").asText());
            assertEquals(2, v.get("requests").size());
            assertEquals("requested", ProductionFixture.first(v.get("requests"), "l1", "state").orElseThrow());
            assertEquals("requested", f.stateOf("l2"));
            assertEquals(2, f.count("SELECT count(*) FROM production_synthetic_orders"));
            assertEquals(5, f.count("SELECT quantity FROM production_requests WHERE line_id = 'l1'"));
            assertEquals(3, f.count("SELECT quantity FROM production_requests WHERE line_id = 'l2'"));
            assertEquals("synthetic-production:" + f.requestId("l1"),
                    f.text("SELECT provider_reference FROM production_requests WHERE line_id = 'l1'"));
            assertEquals("synthetic", f.text("SELECT provider_mode FROM production_requests WHERE line_id = 'l1'"));
            assertEquals("demo-synthetic-production-v1", f.text("SELECT source_version FROM production_requests WHERE line_id = 'l1'"));
            assertEquals("plan-1", f.text("SELECT plan_id FROM production_submissions"));
            assertEquals("p1", f.text("SELECT plan_versions->>'policy' FROM production_submissions"));
            assertEquals("greg-1", f.text("SELECT requested_by FROM production_submissions"));
            assertEquals(2, f.count("SELECT count(*) FROM production_responses WHERE state = 'requested'"));
            assertEquals(0, f.count("SELECT count(*) FROM production_confirmations"));
            assertEquals("2026-11-13T09:00:00Z", f.text("SELECT to_char(requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM production_submissions"));
        }
    }

    @Test
    void replayWithTheSameCommandAnswersTheSameAndWritesNothing() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            JsonNode first = ProductionFixture.value(f.submit("cmd-1"));
            List<Long> before = f.footprint();
            ProductionResult again = f.submit("cmd-1");
            ProductionResult.Ok ok = assertInstanceOf(ProductionResult.Ok.class, again);
            assertTrue(ok.replayed());
            assertEquals(first, ok.value());
            assertEquals(before, f.footprint());
        }
    }

    @Test
    void sameCommandIdWithDifferentInputConflictsAndWritesNothing() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("cmd-1");
            List<Long> before = f.footprint();
            ProductionResult r = f.service.submit(f.ctx(), new ProductionService.SubmitInput("cmd-1", "plan-1",
                    Map.of("forecast", "f1", "policy", "p1", "stock", "s2")));
            assertEquals("idempotency-input-changed", assertInstanceOf(ProductionResult.Conflict.class, r).code());
            assertEquals(before, f.footprint());
        }
    }

    @Test
    void stalePlanOrVersionNeedsAReplanAndWritesNothing() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            List<Long> before = f.footprint();
            f.plan.reading = ProductionFixture.snapshot("plan-2", Map.of("forecast", "f1", "policy", "p2", "stock", "s1", "extra", "x"),
                    true, ProductionFixture.line("l1", "3 Series Saloon", "320i", 5));
            ProductionResult.Conflict c = assertInstanceOf(ProductionResult.Conflict.class, f.submit("cmd-1"));
            assertEquals("replan-needed", c.code());
            assertEquals("Inputs changed since the preview. Replan before submitting.", c.reason());
            assertEquals(List.of("extra", "plan", "policy"), List.of(c.details().get("changedInputs").get(0).asText(),
                    c.details().get("changedInputs").get(1).asText(), c.details().get("changedInputs").get(2).asText()));
            assertEquals("plan-2", c.details().get("current").get("planId").asText());
            assertEquals("p2", c.details().get("current").get("versions").get("policy").asText());
            assertEquals(before, f.footprint());
            assertEquals(0, f.count("SELECT count(*) FROM production_synthetic_orders"));
        }
    }

    @Test
    void infeasibleAndEmptyPlansAreRefusedBeforeAnythingIsWritten() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            List<Long> before = f.footprint();
            f.plan.reading = ProductionFixture.snapshot("plan-1", ProductionFixture.VERSIONS, false,
                    ProductionFixture.line("l1", "3 Series Saloon", "320i", 5));
            ProductionResult.Invalid a = assertInstanceOf(ProductionResult.Invalid.class, f.submit("cmd-1"));
            assertEquals("plan-not-feasible", a.code());
            f.plan.reading = ProductionFixture.snapshot("plan-1", ProductionFixture.VERSIONS, true,
                    ProductionFixture.line("l1", "3 Series Saloon", "320i", 0));
            ProductionResult.Invalid b = assertInstanceOf(ProductionResult.Invalid.class, f.submit("cmd-2"));
            assertEquals("plan-has-no-order", b.code());
            assertEquals("This plan orders no vehicles.", b.reason());
            assertEquals(before, f.footprint());
        }
    }

    @Test
    void validationRefusesBadInputBeforeAnyRead() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            for (ProductionService.SubmitInput bad : List.of(
                    new ProductionService.SubmitInput("", "plan-1", ProductionFixture.VERSIONS),
                    new ProductionService.SubmitInput("c", " ", ProductionFixture.VERSIONS),
                    new ProductionService.SubmitInput("c", "plan-1", Map.of()),
                    new ProductionService.SubmitInput("c", "plan-1", Map.of("a", " ")),
                    new ProductionService.SubmitInput("x".repeat(201), "plan-1", ProductionFixture.VERSIONS))) {
                assertInstanceOf(ProductionResult.Invalid.class, f.service.submit(f.ctx(), bad));
            }
            assertEquals(0, f.count("SELECT count(*) FROM production_submissions"));
        }
    }

    @Test
    void anUnavailablePlanOrClockWritesNothing() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            List<Long> before = f.footprint();
            f.plan.reading = new Unavailable("plan-not-configured", "Greg's order plan is not connected to Production requests yet.");
            ProductionResult.Unavailable u = assertInstanceOf(ProductionResult.Unavailable.class, f.submit("cmd-1"));
            assertEquals("plan-not-configured", u.code());
            assertEquals(before, f.footprint());
            assertEquals(new UnconfiguredPlanSnapshot().current(f.ctx()),
                    new Unavailable("plan-not-configured", "Greg's order plan is not connected to Production requests yet."));
        }
    }

    @Test
    void anUnsetDemoClockWritesNothing() throws Exception {
        try (ProductionFixture f = ProductionFixture.create(false)) {
            List<Long> before = f.footprint();
            ProductionResult.Unavailable c = assertInstanceOf(ProductionResult.Unavailable.class, f.submit("cmd-1"));
            assertEquals("The demo clock has not been set. Try again shortly.", c.reason());
            assertEquals(before, f.footprint());
        }
    }

    @Test
    void aSecondCommandForTheSamePlanIsRefusedAndNothingIsSentTwice() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("cmd-1");
            List<Long> before = f.footprint();
            ProductionResult.Conflict c = assertInstanceOf(ProductionResult.Conflict.class, f.submit("cmd-2"));
            assertEquals("plan-already-submitted", c.code());
            assertEquals("This plan has already been sent to Production.", c.reason());
            assertEquals(before, f.footprint());
            assertEquals(2, f.count("SELECT count(*) FROM production_synthetic_orders"));
        }
    }

    @Test
    void anUnknownChoiceIsRefusedWhileTheOtherLineIsRequested() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.plan.reading = ProductionFixture.snapshot("plan-1", ProductionFixture.VERSIONS, true,
                    ProductionFixture.line("l1", "3 Series Saloon", "320i", 5),
                    ProductionFixture.line("l2", "7 Series", "740d", 2));
            JsonNode v = ProductionFixture.value(f.submit("cmd-1"));
            assertEquals("requested", f.stateOf("l1"));
            assertEquals("refused", f.stateOf("l2"));
            assertEquals("unknown-production-choice", ProductionFixture.first(v.get("requests"), "l2", "code").orElseThrow());
            assertEquals("Choose a supplied model and derivative.", ProductionFixture.first(v.get("requests"), "l2", "reason").orElseThrow());
            assertEquals(0, f.count("SELECT count(*) FROM production_confirmations"));
            assertNotEquals("Requested. Production has not confirmed any of this yet.", v.get("message").asText());
        }
    }

    @Test
    void theLiveStubMarksEveryLineUnsupportedAndModeNoneWritesNothing() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.use(new LiveProductionProviderStub());
            JsonNode v = ProductionFixture.value(f.submit("cmd-1"));
            assertEquals("unsupported", f.stateOf("l1"));
            assertEquals("live-production-unsupported", ProductionFixture.first(v.get("requests"), "l1", "code").orElseThrow());
            assertEquals("Live Production ordering is not connected yet. Nothing was sent.",
                    ProductionFixture.first(v.get("requests"), "l1", "reason").orElseThrow());
            assertEquals(0, f.count("SELECT count(*) FROM production_synthetic_orders"));
        }
        try (ProductionFixture f = ProductionFixture.create()) {
            f.use(new UnconfiguredProductionProvider());
            List<Long> before = f.footprint();
            ProductionResult.Unavailable u = assertInstanceOf(ProductionResult.Unavailable.class, f.submit("cmd-1"));
            assertEquals("production-not-configured", u.code());
            assertEquals(before, f.footprint());
        }
    }

    @Test
    void aLostResponseLeavesTheLineUncertainAndARetryReconcilesToRequested() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            Wrapper w = new Wrapper(f.synthetic, Wrapper.Mode.LOSE_RESPONSE, 1);
            f.use(w);
            ProductionResult.Pending p = assertInstanceOf(ProductionResult.Pending.class, f.submit("cmd-1"));
            assertEquals("Production has not answered yet. Retry with the same request to continue without duplicates.",
                    p.value().get("message").asText());
            assertEquals("uncertain", f.stateOf("l1"));
            assertEquals("requested", f.stateOf("l2"));
            assertEquals(1, f.count("SELECT attempts FROM production_requests WHERE line_id = 'l1'"));
            ProductionResult.Ok ok = assertInstanceOf(ProductionResult.Ok.class, f.submit("cmd-1"));
            assertTrue(ok.replayed());
            assertEquals("requested", f.stateOf("l1"));
            assertEquals(2, f.count("SELECT count(*) FROM production_synthetic_orders"));
            assertEquals(2, w.submits.get(), "the retry reconciled and did not submit again");
            assertEquals(2, f.count("SELECT count(*) FROM production_responses"));
        }
    }

    @Test
    void aProviderThatWasDownThenUpIsReconciledNotFoundAndSubmittedOnce() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            Wrapper w = new Wrapper(f.synthetic, Wrapper.Mode.DOWN_BEFORE_RECORDING, 1);
            f.use(w);
            assertInstanceOf(ProductionResult.Pending.class, f.submit("cmd-1"));
            assertEquals("uncertain", f.stateOf("l1"));
            assertEquals(1, f.count("SELECT count(*) FROM production_synthetic_orders"));
            assertInstanceOf(ProductionResult.Ok.class, f.submit("cmd-1"));
            assertEquals("requested", f.stateOf("l1"));
            assertEquals(2, f.count("SELECT count(*) FROM production_synthetic_orders"));
            assertEquals(1, w.reconciles.get());
            assertEquals(3, w.submits.get());
        }
    }

    @Test
    void aNewServiceOverANewPoolResumesAnUncertainLineWithOneProviderOperation() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.use(new Wrapper(f.synthetic, Wrapper.Mode.LOSE_RESPONSE, 2));
            assertInstanceOf(ProductionResult.Pending.class, f.submit("cmd-1"));
            assertEquals("uncertain", f.stateOf("l1"));
            assertEquals("uncertain", f.stateOf("l2"));
            var pool = f.pool();
            ProductionService restarted = f.service(pool, new SyntheticProductionProvider(pool));
            assertInstanceOf(ProductionResult.Ok.class, restarted.submit(f.ctx(), f.input("cmd-1")));
            assertEquals("requested", f.stateOf("l1"));
            assertEquals("requested", f.stateOf("l2"));
            assertEquals(2, f.count("SELECT count(*) FROM production_synthetic_orders"));
        }
    }

    @Test
    void anUncertainCommitOfTheIntentIsResolvedByARetryWithNoDuplicates() throws Exception {
        for (FlakyCommitDataSource.Mode mode : FlakyCommitDataSource.Mode.values()) {
            try (ProductionFixture f = ProductionFixture.create()) {
                var flaky = new FlakyCommitDataSource(f.pool(), mode);
                ProductionService broken = new ProductionService(flaky, f.synthetic, f.plan, new TickProductionClock(f.pool()));
                ProductionResult r = broken.submit(f.ctx(), f.input("cmd-1"));
                assertInstanceOf(ProductionResult.Uncertain.class, r);
                assertEquals(mode == FlakyCommitDataSource.Mode.COMMIT_THEN_FAIL ? 2 : 0,
                        f.count("SELECT count(*) FROM production_requests"));
                assertEquals(0, f.count("SELECT count(*) FROM production_synthetic_orders"));
                ProductionResult.Ok ok = assertInstanceOf(ProductionResult.Ok.class, f.submit("cmd-1"));
                assertEquals(2, ok.value().get("requests").size());
                assertEquals(1, f.count("SELECT count(*) FROM production_submissions"));
                assertEquals(2, f.count("SELECT count(*) FROM production_requests"));
                assertEquals(2, f.count("SELECT count(*) FROM production_synthetic_orders"));
            }
        }
    }
}
