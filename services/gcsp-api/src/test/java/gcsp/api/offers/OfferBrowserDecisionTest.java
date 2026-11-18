package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;

/** The actual browser command coordinates must reach the owner guard before any command/provider work. */
class OfferBrowserDecisionTest {
    @Test
    void angularDecisionCoordinatesDoNotBypassOrPreventTheOwnerGuard() {
        OfferAccessTest.Fake records = new OfferAccessTest.Fake();
        records.result = new OfferRecords.Found(OfferFixtures.active("someone-else"));
        AtomicBoolean activeRead = new AtomicBoolean();
        OfferDecisions decisions = new OfferDecisions(() -> { activeRead.set(true); return false; },
                () -> { throw new AssertionError("No database access for a refused owner"); },
                new OfferAccess(records, context -> OfferFixtures.NOW), null, context -> OfferFixtures.NOW,
                () -> { throw new AssertionError("No provider access for a refused owner"); });

        OfferOutcome refused = decisions.decide(OfferFixtures.employee("E-1"), OfferFixtures.OFFER, command());

        assertEquals(403, refused.http());
        assertEquals("offer-not-owned", refused.code());
        assertFalse(activeRead.get());
    }

    @Test
    void theSubmittedRunAndImmutableQuoteRevisionAreCheckedBeforeAnyWrite() {
        OfferAccessTest.Fake records = new OfferAccessTest.Fake();
        records.result = new OfferRecords.Found(OfferFixtures.active("E-1"));
        OfferDecisions decisions = new OfferDecisions(() -> { throw new AssertionError("No command work"); },
                () -> { throw new AssertionError("No database access"); },
                new OfferAccess(records, context -> OfferFixtures.NOW), null, context -> OfferFixtures.NOW,
                () -> { throw new AssertionError("No provider access"); });
        ObjectNode wrongRun = command().put("runId", "another-run");
        assertEquals("stale-run", decisions.decide(OfferFixtures.employee("E-1"), OfferFixtures.OFFER, wrongRun).status());
        ObjectNode wrongQuote = command().put("expectedQuoteVersion", 2);
        assertEquals("stale-version", decisions.decide(OfferFixtures.employee("E-1"), OfferFixtures.OFFER, wrongQuote).code());
    }

    private static ObjectNode command() {
        return JsonNodeFactory.instance.objectNode().put("commandId", "angular-decline-1")
                .put("runId", "run-1").put("decision", "decline").put("reasonCode", "body-style")
                .put("expectedOfferVersion", 7).put("expectedHoldVersion", 3).put("expectedQuoteVersion", 1);
    }
}
