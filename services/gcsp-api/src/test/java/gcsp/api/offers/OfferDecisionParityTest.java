package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.List;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** Java (http, status, code) for each Node decline outcome in server/gcsp/offers/decision.js (decide, #load, #transact). */
class OfferDecisionParityTest {

    private static ObjectNode standard(DecisionEnv e) {
        return DecisionEnv.decline("cmd-1", "size", 1, 1);
    }

    private record Case(String name, ThrowingSetup setup, ThrowingBody body, int http, String status, String code) {}

    @FunctionalInterface
    private interface ThrowingBody {
        ObjectNode apply(DecisionEnv env) throws SQLException;
    }

    private static ObjectNode accept(DecisionEnv e) throws SQLException {
        return e.accept("cmd-1", 1, 1, null);
    }

    @FunctionalInterface
    private interface ThrowingSetup {
        void run(DecisionEnv env) throws SQLException;
    }

    private static final List<Case> CASES = List.of(
            new Case("declines", e -> {}, OfferDecisionParityTest::standard, 200, "ok", null),
            new Case("unknown reason is invalid", e -> {}, e -> DecisionEnv.decline("c", "colour", 1, 1), 400, "invalid", "invalid-offer-decision"),
            new Case("missing reason is invalid", e -> {}, e -> {
                ObjectNode b = DecisionEnv.decline("c", "size", 1, 1);
                b.remove("reasonCode");
                return b;
            }, 400, "invalid", "invalid-offer-decision"),
            new Case("extra key is invalid", e -> {}, e -> {
                ObjectNode b = DecisionEnv.decline("c", "size", 1, 1);
                b.put("runId", "run-1");
                return b;
            }, 400, "invalid", "invalid-offer-decision"),
            new Case("decline with terms is invalid", e -> {}, e -> {
                ObjectNode b = DecisionEnv.decline("c", "size", 1, 1);
                b.put("termsDigest", "x");
                return b;
            }, 400, "invalid", "invalid-offer-decision"),
            new Case("non-positive version is invalid", e -> {}, e -> DecisionEnv.decline("c", "size", 0, 1), 400, "invalid", "invalid-offer-decision"),
            new Case("stale offer version", e -> {}, e -> DecisionEnv.decline("c", "size", 2, 1), 409, "conflict", "stale-version"),
            new Case("stale hold version", e -> {}, e -> DecisionEnv.decline("c", "size", 1, 2), 409, "conflict", "stale-version"),
            new Case("deadline passed", e -> e.now[0] = DecisionEnv.NOW.plusSeconds(3600), OfferDecisionParityTest::standard, 409, "conflict", "deadline-passed"),
            new Case("already declined", e -> {
                e.decide(DecisionEnv.decline("first", "size", 1, 1));
            }, e -> DecisionEnv.decline("c", "size", 1, 1), 409, "conflict", "offer-no-longer-pending"),
            new Case("car taken", e -> e.pg.update("UPDATE stock_cars SET state = 'allocated'"), OfferDecisionParityTest::standard, 409, "conflict",
                    "selection-authority-changed"),
            new Case("remote mode", e -> e.mode = "remote", OfferDecisionParityTest::standard, 503, "unavailable", "offer-authority-inconsistent"),
            new Case("registry missing", e -> e.decisions = e.service(DecisionEnv.policy(false)), OfferDecisionParityTest::standard, 503, "unavailable",
                    "decline-reasons-unavailable"),
            new Case("accepts", e -> {}, OfferDecisionParityTest::accept, 200, "ok", null),
            new Case("accept quote lapsed", e -> e.pg.rollQuoteEnd(Instant.parse("2026-11-14T08:59:00Z")),
                    OfferDecisionParityTest::accept, 409, "conflict", "quote-no-longer-valid"),
            new Case("accept allowance exceeded", e -> e.pg.rollMonthlyPoints(1200), OfferDecisionParityTest::accept, 409,
                    "conflict", "allowance-exceeded"),
            new Case("accept no longer eligible", e -> e.pg.alterQuote("UPDATE buddy_quotes SET quote = jsonb_set(quote, "
                    + "'{snapshot,facts,eligibilityModelKey,value}', '\"F70 Sports Hatch|M135\"')"),
                    OfferDecisionParityTest::accept, 409, "conflict", "current-eligibility-refused"),
            new Case("accept brief changed", e -> {
                e.pg.update("UPDATE brief_heads SET brief_version = 4");
                e.insertBrief(4, DecisionEnv.ESSENTIALS.replace("\"value\":5", "\"value\":7"));
            }, OfferDecisionParityTest::accept, 409, "conflict", "brief-changed-review-required"),
            new Case("accept deadline passed", e -> e.now[0] = DecisionEnv.NOW.plusSeconds(3600),
                    OfferDecisionParityTest::accept, 409, "conflict", "deadline-passed"),
            new Case("accept stale version", e -> {}, e -> e.accept("c", 2, 1, null), 409, "conflict", "stale-version"),
            new Case("accept after decline", e -> e.decide(DecisionEnv.decline("first", "size", 1, 1)),
                    OfferDecisionParityTest::accept, 409, "conflict", "offer-no-longer-pending"),
            new Case("accept remote mode", e -> e.mode = "remote", OfferDecisionParityTest::accept, 503, "unavailable",
                    "remote-decision-protocol-required"),
            new Case("accept without terms is invalid", e -> {}, e -> {
                ObjectNode b = accept(e);
                b.remove("termsDigest");
                return b;
            }, 400, "invalid", "invalid-offer-decision"));

    @Test
    void javaAnswersLikeNode() throws Exception {
        for (Case c : CASES) {
            try (DecisionEnv env = DecisionEnv.open(true)) {
                c.setup().run(env);
                OfferOutcome o = env.decide(c.body().apply(env));
                assertEquals(c.http(), o.http(), c.name());
                assertEquals(c.status(), o.status(), c.name());
                assertEquals(c.code(), o.code(), c.name());
            }
        }
    }
}
