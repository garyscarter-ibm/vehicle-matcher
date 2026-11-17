package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.LocalSyntheticBuddy;
import gcsp.api.identity.Principal;
import gcsp.api.notify.OfferFacts;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.SelectionConversionPort;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import javax.sql.DataSource;

/** Builds the offer services over a given database for the comparison replay, which runs outside CDI. */
public final class ComparisonOfferPorts {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private ComparisonOfferPorts() {}

    public static OfferAccess access(DataSource source, PolicyClock clock) {
        return new OfferAccess(new PostgresOfferRecords(() -> true, () -> source), clock);
    }

    public static OfferFacts facts(DataSource source) {
        return new PostgresOfferFacts(() -> true, () -> source);
    }

    public static Decisions decisions(DataSource source, OfferAccess access, PolicyService policy, PolicyClock clock) {
        PolicyService whole = new WholePoints(policy);
        return new Decisions(source, new OfferDecisions(() -> true, () -> source, access, whole, clock,
                LocalSyntheticBuddy::new), clock);
    }

    // A scaled allowance can be fractional; against whole point costs, comparing its floor gives the same answer.
    @jakarta.enterprise.inject.Vetoed
    private static final class WholePoints extends PolicyService {

        private final PolicyService inner;

        WholePoints(PolicyService inner) {
            super(null);
            this.inner = inner;
        }

        @Override
        public gcsp.api.policy.PolicyResult getAssumption(String key, gcsp.api.policy.PolicyRead read) {
            return inner.getAssumption(key, read);
        }

        @Override
        public gcsp.api.policy.PolicyResult getAllowance(gcsp.api.policy.PolicyContext context, gcsp.api.policy.PolicyRead read) {
            gcsp.api.policy.PolicyResult result = inner.getAllowance(context, read);
            JsonNode points = result.ok() ? result.value().get("monthlyPoints") : null;
            if (points == null || points.isIntegralNumber() || !points.isNumber()) return result;
            ObjectNode body = result.body().deepCopy();
            ((ObjectNode) body.get("value")).put("monthlyPoints", (long) Math.floor(points.doubleValue()));
            return new gcsp.api.policy.PolicyResult(result.status(), result.policyVersion(), body);
        }

        @Override
        public gcsp.api.policy.PolicyResult getPointsCost(gcsp.api.policy.PolicyContext context, JsonNode car,
                gcsp.api.policy.PolicyRead read) {
            return inner.getPointsCost(context, car, read);
        }

        @Override
        public gcsp.api.policy.PolicyResult getEligibility(gcsp.api.policy.PolicyContext context, JsonNode car,
                gcsp.api.policy.PolicyRead read) {
            return inner.getEligibility(context, car, read);
        }
    }

    /** Decline is the offer service's own; accept is its Buddy conversion run as a local decision, with no ordering handoff. */
    public static final class Decisions {

        private final DataSource source;
        private final OfferDecisions decisions;
        private final PolicyClock clock;

        private Decisions(DataSource source, OfferDecisions decisions, PolicyClock clock) {
            this.source = source;
            this.decisions = decisions;
            this.clock = clock;
        }

        public OfferOutcome decide(Principal p, String offerId, JsonNode body) {
            if ("accept".equals(body.path("decision").asText())) return accept(p, offerId, body);
            return decisions.decide(p, offerId, body);
        }

        private OfferOutcome accept(Principal p, String offerId, JsonNode body) {
            try {
                RunContext ctx = new RunContext(p.environmentId(), p.runId(), "employee:" + p.employeeId());
                Instant now = clock.now(ctx);
                Object[] row;
                try (Connection c = source.getConnection()) {
                    row = OfferDecisions.one(c, "SELECT h.slot_id, k.version, o.brief_version, o.quote_id, h.hold_id "
                            + "FROM buddy_offers o JOIN custody_holds h ON h.environment_id = o.environment_id "
                            + "AND h.run_id = o.run_id AND h.hold_id = o.hold_id JOIN stock_cars k "
                            + "ON k.environment_id = o.environment_id AND k.run_id = o.run_id AND k.order_uuid = o.order_uuid "
                            + "WHERE o.environment_id = ? AND o.run_id = ? AND o.offer_id = ?",
                            rs -> new Object[] {rs.getString(1), rs.getLong(2), rs.getLong(3), rs.getString(4), rs.getString(5)},
                            p.environmentId(), p.runId(), offerId);
                }
                if (row == null) return OfferOutcome.notFound();
                long offerVersion = body.get("expectedOfferVersion").longValue();
                long holdVersion = body.get("expectedHoldVersion").longValue();
                String commandId = body.get("commandId").textValue();
                ObjectNode input = F.objectNode();
                input.put("offerId", offerId).put("decision", "accept").put("expectedOfferVersion", offerVersion)
                        .put("expectedHoldVersion", holdVersion);
                OfferDecisions.Verdict verdict = new OfferDecisions.Verdict();
                BuddyOfferConversion conversion = new BuddyOfferConversion(decisions, verdict,
                        new BuddyOfferConversion.Ask(p, offerId, commandId, Canonical.digest(input), offerVersion, null));
                OrderingScope scope = new OrderingScope(p.environmentId(), p.runId(), p.employeeId(), (String) row[0],
                        p.policyVersion());
                Command command = new Command("offer.decide", "offer-decision:" + offerId + ":" + commandId, input);
                Outcome o = new TransactionRunner(source).execute(ctx, command, tx -> {
                    SelectionConversionPort.Conversion made = conversion.convert(tx, scope,
                            new SelectionConversionPort.ConversionRequest((String) row[4], holdVersion, (Long) row[2],
                                    (String) row[3], (Long) row[1], "comparison-local:" + offerId, now));
                    if (made instanceof SelectionConversionPort.Refusal r) return WorkResult.refuse(r.code(), r.code());
                    return WorkResult.ok(F.objectNode().put("offerId", offerId).put("state", "accepted")
                            .put("decidedAt", PolicyClock.iso(now)));
                });
                if (o instanceof Outcome.Committed c) return OfferOutcome.ok(c.result());
                return verdict.outcome != null ? verdict.outcome : OfferOutcome.of(409, "conflict", o.code(), o.code(), false);
            } catch (SQLException | RuntimeException e) {
                return OfferOutcome.unavailable();
            }
        }
    }
}
