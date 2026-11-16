package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountOutcome;
import gcsp.api.account.AccountScope;
import gcsp.api.account.ManualStock;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import javax.sql.DataSource;

/**
 * The real selection port over the manual browse: the claimant is the saved draft's slot and versions, a decision is
 * the browse's own verdict for one car, and the order draft is what ordering snapshots (manual-conversion.js prepare).
 */
public final class ManualSelection implements ManualSelectionPort {

    static final String UNAVAILABLE = "manual-selection-unavailable";
    static final String DRAFT_REVIEW = "draft-review-required";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String OWN_HOLD_SQL = "SELECT order_uuid FROM custody_holds WHERE environment_id = ? AND run_id = ? "
            + "AND employee_id = ? AND hold_type = 'cart' AND state = 'active' ORDER BY hold_id LIMIT 1";

    private final Supplier<Optional<ManualStock>> stock;
    private final Supplier<DataSource> dataSource;

    public ManualSelection(Supplier<Optional<ManualStock>> stock, Supplier<DataSource> dataSource) {
        this.stock = stock;
        this.dataSource = dataSource;
    }

    @Override
    public Claimant claimant(ClaimScope scope) {
        Optional<ManualStock> browse = stock.get();
        if (browse.isEmpty()) return new NoClaimant(UnconfiguredManualSelection.CODE);
        Optional<ManualStock.Standing> standing = browse.get().standing(identity(scope));
        if (standing.isEmpty()) return new NoClaimant(DRAFT_REVIEW);
        ManualStock.Standing s = standing.get();
        return new Known(s.slotId(), s.contextVersion(), s.draftVersion(), s.driverId(), scope.policyVersion());
    }

    @Override
    public Decision decide(ClaimScope scope, String orderUuid) {
        Optional<ManualStock> browse = stock.get();
        if (browse.isEmpty()) return new NoDecision(UnconfiguredManualSelection.CODE);
        String owned;
        try {
            owned = ownCar(scope);
        } catch (SQLException | RuntimeException e) {
            return new NoDecision(UNAVAILABLE);
        }
        ManualStock.Browsed browsed = browse.get().browse(identity(scope), owned);
        AccountOutcome outcome = browsed.outcome();
        if (!outcome.isOk()) return new NoDecision(UNAVAILABLE);
        for (JsonNode decision : outcome.value().get("decisions")) {
            if (!orderUuid.equals(decision.get("orderUuid").textValue())) continue;
            if (!"eligible".equals(decision.get("gateStatus").asText()) || !decision.hasNonNull("terms")) {
                return new NotEligible(decision.get("gateStatus").asText());
            }
            JsonNode terms = decision.get("terms");
            Instant until;
            try {
                until = Instant.parse(terms.get("validUntil").asText());
            } catch (DateTimeParseException | NullPointerException e) {
                return new NoDecision(UNAVAILABLE);
            }
            ObjectNode facts = F.objectNode();
            facts.set("facts", browsed.carFacts().get(orderUuid));
            return new Eligible(decision.get("configurationId").textValue(), facts, stableTerms(terms), until);
        }
        return new NotEligible("not-in-stock");
    }

    @Override
    public OrderDraft orderDraft(ClaimScope scope) {
        Optional<ManualStock> browse = stock.get();
        if (browse.isEmpty()) return new NoDecision(UnconfiguredManualSelection.CODE);
        Optional<ManualStock.OrderFacts> facts = browse.get().orderFacts(identity(scope));
        if (facts.isEmpty()) return new NoDecision(DRAFT_REVIEW);
        ManualStock.OrderFacts f = facts.get();
        return new Draft(f.mode(), f.driver(), f.contact(), f.employee(), f.sourceVersions());
    }

    /** The terms a quote pins and digests: without the version, start and end that evaluation stamps with the clock. */
    static JsonNode stableTerms(JsonNode terms) {
        ObjectNode out = F.objectNode();
        for (String key : List.of("kind", "points", "allowanceInputs", "contribution")) out.set(key, terms.get(key));
        JsonNode provenance = terms.get("provenance");
        ObjectNode pin = out.putObject("provenance");
        for (String key : List.of("sourceRef", "version", "assurance")) pin.set(key, provenance.get(key));
        return out;
    }

    private static AccountScope identity(ClaimScope scope) {
        return new AccountScope(scope.environmentId(), scope.runId(), scope.employeeId(), null, List.of("employee"), null,
                null, null, null, scope.policyVersion());
    }

    /** The car behind the employee's own active claim, which stays available to them while it is held. */
    private String ownCar(ClaimScope scope) throws SQLException {
        try (Connection c = dataSource.get().getConnection()) {
            return Db.first(c, OWN_HOLD_SQL, rs -> rs.getString(1), scope.environmentId(), scope.runId(),
                    scope.employeeId()).orElse(null);
        }
    }
}
