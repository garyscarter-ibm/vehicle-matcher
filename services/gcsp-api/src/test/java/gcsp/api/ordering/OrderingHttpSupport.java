package gcsp.api.ordering;

import static io.restassured.RestAssured.given;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.restassured.specification.RequestSpecification;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;
import javax.sql.DataSource;

/** Helpers: the database is shared and reused, so every test seeds its own slot, car and hold under fresh ids. */
final class OrderingHttpSupport {

    static final String BASE = "/api/gcsp/v1/manual/order";
    static final String TERMS = BASE + "/terms";
    static final String RECONCILE = "/api/gcsp/v1/presenter/ordering/reconcile";
    static final String PROGRESS = "/api/gcsp/v1/orders/progress";
    static final ObjectMapper JSON = new ObjectMapper();

    /** One orderable entitlement: its slot, the hold and the car it holds. */
    record Seed(String slot, String hold, String car) {}

    private OrderingHttpSupport() {}

    static RequestSpecification as() {
        return given().header("Authorization", "Bearer " + OrderingHttpProfiles.TOKEN).contentType("application/json");
    }

    static Seed seed(DataSource ds) throws SQLException {
        String id = UUID.randomUUID().toString().substring(0, 12);
        Seed s = new Seed("slot-http-" + id, "hold-http-" + id, "car-http-" + id);
        String env = OrderingHttpProfiles.ENV;
        String run = OrderingHttpProfiles.RUN;
        String owner = OrderingHttpProfiles.OWNER;
        update(ds, "INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                env, run, owner);
        update(ds, "INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, ?, ?, 1)",
                env, run, s.slot(), owner);
        update(ds, "INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                + "VALUES (?, ?, ?, 'cfg-http', 'available')", env, run, s.car());
        update(ds, "INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'cart', 'active', ?)", env, run, s.hold(),
                s.car(), owner, s.slot(), java.sql.Timestamp.from(Instant.now().plusSeconds(86_400)));
        return s;
    }

    static OrderingScope scope(Seed s) {
        return new OrderingScope(OrderingHttpProfiles.ENV, OrderingHttpProfiles.RUN, OrderingHttpProfiles.OWNER, s.slot(),
                OrderingHttpProfiles.VERSION);
    }

    /** A valid cart body for the seed; declarations are the new-car pair. */
    static ObjectNode body(Seed s, String commandId, String termsDigest) {
        ObjectNode b = JSON.createObjectNode();
        b.put("commandId", commandId);
        b.putObject("source").put("type", "cart").put("holdId", s.hold()).put("expectedHoldVersion", 1)
                .put("expectedDraftVersion", 1);
        b.put("expectedQuoteId", "q-" + s.hold()).put("expectedStockVersion", 1);
        b.put("termsDigest", termsDigest);
        b.putObject("declarations").put("terms", true).put("driver", true);
        return b;
    }

    static String termsDigest() {
        return as().get(TERMS).then().statusCode(200).extract().path("value.termsDigest");
    }

    static long count(DataSource ds, String sql, Object... params) throws SQLException {
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0;
            }
        }
    }

    private static void update(DataSource ds, String sql, Object... params) throws SQLException {
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }
}
