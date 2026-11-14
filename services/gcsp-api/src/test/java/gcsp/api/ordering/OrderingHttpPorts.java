package gcsp.api.ordering;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountOutcome;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.policy.PolicyClock;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;

/** Test beans enabled only by the ordering HTTP profiles: the account slot, the cart converter and a fixed clock. */
public final class OrderingHttpPorts {

    static final Instant NOW = Instant.parse("2026-11-13T12:00:00Z");
    private static final ObjectMapper JSON = new ObjectMapper();

    private OrderingHttpPorts() {}

    /** The account projection with one slot; the HR snapshot path itself is covered by the account tests. */
    @Alternative
    @ApplicationScoped
    public static class TestSlots extends OrderingSlots {
        private volatile String slot;
        private volatile boolean enabled = true;
        private volatile boolean down;

        /** Called through the client proxy, so state is set by method, never by field. */
        public void use(String slotId, boolean orderable, boolean accountDown) {
            this.slot = slotId;
            this.enabled = orderable;
            this.down = accountDown;
        }

        @Override
        protected AccountOutcome read(Principal p) {
            if (down) return AccountOutcome.unavailable("employee-contract");
            ObjectNode value = JSON.createObjectNode().put("state", "ready");
            ArrayNode slots = value.putArray("slots");
            if (slot != null) {
                slots.addObject().put("entitlementSlotId", slot).putObject("ordering").put("enabled", enabled);
            }
            return AccountOutcome.ok(value);
        }
    }

    /** The source authority: validates and allocates the hold and car inside the ordering transaction. */
    @Alternative
    @ApplicationScoped
    public static class Cart implements SelectionConversionPort {
        @Override
        public String sourceType() {
            return "cart";
        }

        @Override
        public Preparation prepare(OrderingScope scope, SourceInput source) {
            return new Prepared("new", JSON.createObjectNode().put("name", "Test Driver"),
                    JSON.createObjectNode().put("email", "d@example.test"),
                    JSON.createObjectNode().put("employeeId", scope.employeeId()), JSON.createObjectNode().put("draft", 1));
        }

        @Override
        public Conversion convert(Tx tx, OrderingScope scope, ConversionRequest q) throws SQLException {
            RunContext c = tx.context();
            Optional<Object[]> hold = tx.first("SELECT version, state, order_uuid FROM custody_holds WHERE environment_id = ? "
                    + "AND run_id = ? AND hold_id = ? AND employee_id = ? FOR UPDATE",
                    rs -> new Object[] {rs.getLong(1), rs.getString(2), rs.getString(3)}, c.environmentId(), c.runId(),
                    q.holdId(), scope.employeeId());
            if (hold.isEmpty()) return new Refusal("forbidden");
            if (!"active".equals(hold.get()[1]) || (long) hold.get()[0] != q.expectedHoldVersion()) return new Refusal("claim-changed");
            String quoteId = "q-" + q.holdId();
            if (!quoteId.equals(q.expectedQuoteId())) return new Refusal("quote-changed");
            String uuid = (String) hold.get()[2];
            tx.write("UPDATE custody_holds SET state = 'allocated', version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND hold_id = ?", c.environmentId(), c.runId(), q.holdId());
            tx.write("UPDATE stock_cars SET state = 'allocated', version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?", c.environmentId(), c.runId(), uuid);
            String number = String.valueOf(1_000_000 + Math.floorMod(uuid.hashCode(), 9_000_000));
            return new Converted(uuid, number, "cfg-1", JSON.createObjectNode().put("quoteId", quoteId).put("orderUuid", uuid),
                    JSON.createObjectNode().put("colour", "blue"), "renewal-" + scope.entitlementSlotId());
        }
    }

    /** The terms are dated, so the tests pin the clock inside their validity. */
    @Alternative
    @ApplicationScoped
    public static class Clock implements PolicyClock {
        @Override
        public Instant now(RunContext context) {
            return NOW;
        }
    }
}
