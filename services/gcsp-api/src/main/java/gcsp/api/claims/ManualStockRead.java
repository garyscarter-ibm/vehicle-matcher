package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountOutcome;
import gcsp.api.account.AccountScope;
import gcsp.api.account.ManualStock;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Optional;
import javax.sql.DataSource;

/** The stock browse a claim can follow: Node's manual-claims browseStock over the manual context browse. */
public final class ManualStockRead {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String OFFER_SQL = "SELECT attributes->>'offerId' FROM custody_holds WHERE environment_id = ? "
            + "AND run_id = ? AND employee_id = ? AND slot_id = ? AND hold_type = 'buddy-offer' AND state IN "
            + "('active', 'claim-pending', 'release-pending', 'selection-pending') ORDER BY hold_id LIMIT 1";
    private static final String VERSION_SQL = "SELECT version FROM stock_cars WHERE environment_id = ? AND run_id = ? "
            + "AND order_uuid = ?";

    private final ManualClaims claims;
    private final ManualStock stock;
    private final DataSource dataSource;

    public ManualStockRead(ManualClaims claims, ManualStock stock, DataSource dataSource) {
        this.claims = claims;
        this.stock = stock;
        this.dataSource = dataSource;
    }

    /** The employee's own due hold settles first (as Node's reconcile); then browse, claim inputs and the held offer. */
    public AccountOutcome read(ClaimScope who, AccountScope identity) {
        if (claims.readClaim(who) instanceof ClaimResult.Unavailable) return AccountOutcome.unavailable("manual-claims");
        ManualStock.Browsed browsed = stock.browse(identity, null);
        if (!browsed.outcome().isOk()) return browsed.outcome();
        ObjectNode value = ((ObjectNode) browsed.outcome().value()).deepCopy();
        JsonNode versions = value.get("versions");
        String digestPolicy = identity.policyVersion();
        try (Connection c = dataSource.getConnection()) {
            ArrayNode decisions = F.arrayNode();
            ArrayNode cars = F.arrayNode();
            for (JsonNode raw : value.get("decisions")) {
                ObjectNode decision = ((ObjectNode) raw).deepCopy();
                boolean eligible = "eligible".equals(decision.get("gateStatus").asText());
                if (eligible) {
                    String order = decision.get("orderUuid").textValue();
                    Optional<Long> stockVersion = Db.first(c, VERSION_SQL, rs -> rs.getLong(1), who.environmentId(),
                            who.runId(), order);
                    ObjectNode input = F.objectNode().put("orderUuid", order);
                    if (stockVersion.isPresent()) input.put("expectedStockVersion", stockVersion.get());
                    else input.putNull("expectedStockVersion");
                    input.set("expectedDraftVersion", decision.get("draftVersion"));
                    input.set("expectedContextVersion", versions.get("context"));
                    input.put("expectedTermsDigest", ManualClaims.termsDigest(digestPolicy,
                            ManualSelection.stableTerms(decision.get("terms"))));
                    decision.set("claimInput", input);
                } else {
                    decision.putNull("claimInput");
                }
                decisions.add(decision);
                if (eligible) cars.add(decision);
            }
            value.set("decisions", decisions);
            value.set("cars", cars);
            value.set("heldOffer", heldOffer(c, who, browsed.slotId()));
        } catch (SQLException e) {
            return AccountOutcome.unavailable("manual-claims");
        }
        return AccountOutcome.ok(value);
    }

    private static JsonNode heldOffer(Connection c, ClaimScope who, String slotId) throws SQLException {
        Optional<Optional<String>> held = Db.first(c, OFFER_SQL, rs -> Optional.ofNullable(rs.getString(1)),
                who.environmentId(), who.runId(), who.employeeId(), slotId);
        if (held.isEmpty()) return F.nullNode();
        ObjectNode out = F.objectNode();
        if (held.get().isPresent()) out.put("offerId", held.get().get()); else out.putNull("offerId");
        return out.put("runId", who.runId());
    }
}
