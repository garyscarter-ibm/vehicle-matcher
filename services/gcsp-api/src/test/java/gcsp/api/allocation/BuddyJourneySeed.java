package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.policy.PolicyClock;
import java.io.IOException;
import java.io.InputStream;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.postgresql.ds.PGSimpleDataSource;

/** Source rows and the tranche plan for the Buddy journeys: three engaged employees and unreleased exact cars. */
public final class BuddyJourneySeed {

    public static final String ENV = "journey-env";
    public static final String RUN = "run-1";
    public static final String POLICY = "gcsp-policy-v1";
    public static final String CAR_1 = "00000000-0000-4000-8000-000000000001";
    public static final String CAR_2 = "00000000-0000-4000-8000-000000000002";
    public static final String CAR_3 = "00000000-0000-4000-8000-000000000003";
    /** Renewal due order is paula, carla, bruno: the policy ranks the earliest renewal first. */
    public static final String PAULA = "employee-paula";
    public static final String CARLA = "employee-carla";
    public static final String BRUNO = "employee-bruno";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ZoneId LONDON = ZoneId.of("Europe/London");

    private record Person(String id, String first, String grade, int dueInDays) {}

    private static final List<Person> PEOPLE = List.of(new Person(PAULA, "Paula", "G7", 30),
            new Person(CARLA, "Carla", "G7", 45), new Person(BRUNO, "Bruno", "G8-10", 60));

    private BuddyJourneySeed() {}

    /** The run clock starts at 09:00 London on the day the app starts, as ScenarioClockStart derives it. */
    static Instant clockStart() {
        return LocalDate.now(LONDON).atTime(9, 0).atZone(LONDON).toInstant();
    }

    /** Local: cars 1 and 2 in one past window. Remote: car 1 now, car 3 in a window ten minutes into the run. */
    static String plan(boolean remote, Instant wall) throws IOException {
        JsonNode rows = resource("/recommendation-source/source-cases.json").path("cases").get(0).path("rows");
        ObjectNode plan = JSON.createObjectNode().put("label", "TEST FIXTURE Buddy journey plan; not stock evidence")
                .put("version", remote ? "buddy-journey-remote-v1" : "buddy-journey-local-v1");
        ArrayNode windows = plan.putArray("windows");
        String until = PolicyClock.iso(wall.plus(400, ChronoUnit.DAYS));
        ObjectNode first = window(windows, "journey-w1", wall.minus(1, ChronoUnit.DAYS));
        stockEntry(first, rows.get(0), until);
        if (remote) stockEntry(window(windows, "journey-w2", clockStart().plus(10, ChronoUnit.MINUTES)), rows.get(2), until);
        else stockEntry(first, rows.get(1), until);
        return plan.toString();
    }

    private static int[] cars(boolean remote) {
        return remote ? new int[] {0, 2} : new int[] {0, 1};
    }

    private static ObjectNode window(ArrayNode windows, String id, Instant at) {
        ObjectNode w = windows.addObject().put("windowId", id).put("availableAt", PolicyClock.iso(at));
        w.putNull("supplyId");
        w.putArray("stock");
        return w;
    }

    private static void stockEntry(ObjectNode window, JsonNode row, String until) {
        ObjectNode car = ((ArrayNode) window.get("stock")).addObject();
        car.put("orderUuid", row.path("orderUuid").asText()).put("orderNumber", row.path("orderNumber").asText())
                .put("configurationId", row.path("configurationId").asText());
        car.putObject("availability").put("availableUntil", until);
    }

    static void seed(String url, String schema, boolean remote, Instant wall) throws Exception {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(url);
        ds.setCurrentSchema(schema);
        try (Connection c = ds.getConnection()) {
            update(c, "INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
            update(c, "INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, RUN);
            JsonNode rows = resource("/recommendation-source/source-cases.json").path("cases").get(0).path("rows");
            for (int index : cars(remote)) car(c, rows.get(index));
            JsonNode golden = resource("/account/node-baseline/paula.json");
            for (Person p : PEOPLE) person(c, golden, p, wall);
        }
    }

    private static void car(Connection c, JsonNode row) throws SQLException {
        ObjectNode attributes = row.deepCopy();
        attributes.remove(List.of("orderUuid", "configurationId", "state", "available", "held", "allocated", "version",
                "release"));
        update(c, "INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes, version) "
                + "VALUES (?, ?, ?, ?, 'unreleased', ?::jsonb, 1)", ENV, RUN, row.path("orderUuid").asText(),
                row.path("configurationId").asText(), attributes.toString());
    }

    private static void person(Connection c, JsonNode golden, Person p, Instant wall) throws Exception {
        String key = p.id().substring("employee-".length());
        JsonNode context = golden.get("context");
        long employeeVersion = golden.path("input").path("employeeVersion").asLong();
        String slotId = "slot-" + key;
        ObjectNode attributes = JSON.createObjectNode();
        for (String field : List.of("companyId", "schemeId")) attributes.set(field, context.get(field));
        attributes.put("gradeId", p.grade()).put("entitlementSlotId", slotId);
        update(c, "INSERT INTO employees (environment_id, run_id, employee_id, attributes, version) VALUES (?, ?, ?, ?::jsonb, ?)",
                ENV, RUN, p.id(), attributes.toString(), employeeVersion);
        JsonNode slot = JSON.readTree(rename(golden.path("input").path("slots").get(0).toString(), p, key));
        ObjectNode slotAttributes = slot.deepCopy();
        slotAttributes.remove(List.of("employeeId", "entitlementSlotId", "capacity", "runId", "version", "createdAt", "updatedAt"));
        update(c, "INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes, version) "
                + "VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)", ENV, RUN, slotId, p.id(), slot.path("capacity").asInt(),
                slotAttributes.toString(), slot.path("version").asLong());
        ObjectNode account = (ObjectNode) JSON.readTree(rename(golden.path("input").path("manualContext").toString(), p, key));
        ((ObjectNode) account.get("account")).put("gradeId", p.grade());
        ((ObjectNode) account.get("contracts").get(0)).put("contractEndDate",
                LocalDate.ofInstant(wall, LONDON).plusDays(p.dueInDays()).toString());
        ((ObjectNode) account.path("employeeFacts").get("requiredBy")).put("value", PolicyClock.iso(wall.plus(365, ChronoUnit.DAYS)));
        update(c, "INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record, version) "
                + "VALUES (?, ?, ?, ?, ?::jsonb, ?)", ENV, RUN, p.id(), account.path("recordSetId").asText(),
                account.toString(), employeeVersion);
        brief(c, p.id());
    }

    private static String rename(String json, Person p, String key) {
        return json.replace("employee-paula", p.id()).replace("slot-paula", "slot-" + key)
                .replace("Paula Mason", p.first() + " Mason").replace("paula.mason@", key + ".mason@");
    }

    private static void brief(Connection c, String employeeId) throws SQLException {
        ObjectNode brief = JSON.createObjectNode().put("schemaVersion", 1);
        brief.putObject("preferences").putObject("body").put("value", "estate").put("importance", 100)
                .put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "employee")
                .put("confirmedAt", "2026-11-05T09:00:00.000Z");
        brief.putObject("essentials");
        ObjectNode buddy = JSON.createObjectNode().put("searchConsent", true).put("holdConsent", true).put("paused", false)
                .put("permissionVersion", 1);
        update(c, "INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, ?, 1)", ENV, RUN,
                employeeId);
        update(c, "INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, operation, "
                + "content, buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, command_id) "
                + "VALUES (?, ?, ?, 1, NULL, 'confirmed', ?::jsonb, ?::jsonb, ?, ?, 'journey-seed', ?::timestamptz, "
                + "'journey-brief-v1')", ENV, RUN, employeeId, brief.toString(), buddy.toString(),
                Canonical.digest(JSON.getNodeFactory().textNode("journey-brief-v1")), POLICY, "2026-11-05T09:00:00.000Z");
    }

    private static void update(Connection c, String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    private static JsonNode resource(String name) throws IOException {
        try (InputStream in = BuddyJourneySeed.class.getResourceAsStream(name)) {
            if (in == null) throw new IOException("Missing retained fixture " + name);
            return JSON.readTree(in);
        }
    }
}
