package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.clock.ClockReading;
import gcsp.api.policy.PolicyService;
import gcsp.api.recommendation.RecommendationCandidates;
import gcsp.api.recommendation.SelectedAccountCandidates;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;

/**
 * Alternative cars through the one Java recommendation calculation allocation uses, over released unoccupied stock the
 * employee can see. Options: 1 employee read, 1 brief read, ceil(N/page) stock pages, 2 account reads, 1 evaluation; check reads one car.
 */
public final class RecommendationCaseSuitability implements CaseCarSuitabilityPort {

    /** The run clock's current reading, empty when it cannot be read. */
    @FunctionalInterface
    public interface Readings {
        Optional<ClockReading> read(String environmentId, String runId);
    }

    static final String BRIEF_REQUIRED = "A confirmed brief is required to evaluate suitable available cars.";
    private static final String BRIEF_UNKNOWN = "charging-unconfirmed";
    private static final int CAR_PAGE = 500;
    private static final String OCCUPYING = "('active', 'claim-pending', 'release-pending', 'selection-pending')";
    private static final String FREE = "FROM stock_cars s WHERE s.environment_id = ? AND s.run_id = ? AND s.state = 'released' "
            + "AND NOT EXISTS (SELECT 1 FROM custody_holds h WHERE h.environment_id = s.environment_id "
            + "AND h.run_id = s.run_id AND h.order_uuid = s.order_uuid "
            + "AND (h.state IN " + OCCUPYING + " OR h.state = 'allocated'))";
    private static final String COLUMNS = "SELECT s.order_uuid, s.configuration_id, s.version, s.attributes::text ";

    private final DataSource dataSource;
    private final EligibleCandidates candidates;
    private final Readings clock;

    public RecommendationCaseSuitability(DataSource dataSource, AccountRecordsPort records, PolicyService policy,
            Readings clock) {
        this.dataSource = dataSource;
        this.candidates = new SelectedAccountCandidates(new RecommendationCandidates(policy), records);
        this.clock = clock;
    }

    private record Employee(long version, JsonNode attributes) {}

    private record Brief(long version, JsonNode content) {}

    @Override
    public Options options(String environmentId, String runId, String employeeId, String policyVersion) {
        try (Connection c = dataSource.getConnection()) {
            Employee employee = employee(c, environmentId, runId, employeeId);
            if (employee == null) return unavailable();
            Brief brief = brief(c, environmentId, runId, employeeId);
            if (brief == null) return new Options(true, List.of(), List.of(), BRIEF_REQUIRED);
            Optional<ClockReading> now = clock.read(environmentId, runId);
            if (now.isEmpty()) return unavailable();
            List<EligibleCandidates.Car> visible = new ArrayList<>();
            String after = "";
            while (true) {
                List<EligibleCandidates.Car> page = cars(c, "AND s.order_uuid > ? ORDER BY s.order_uuid LIMIT ?",
                        environmentId, runId, after, CAR_PAGE);
                for (EligibleCandidates.Car car : page) if (visible(car.attributes(), employee.attributes(), employeeId)) visible.add(car);
                if (page.size() < CAR_PAGE) break;
                after = page.get(page.size() - 1).orderUuid();
            }
            if (visible.isEmpty()) return new Options(true, List.of(), List.of());
            if (!(evaluate(environmentId, runId, employeeId, policyVersion, employee, brief, now.get(), visible)
                    instanceof EligibleCandidates.Evaluated evaluated)) {
                return unavailable();
            }
            return rows(visible, evaluated);
        } catch (SQLException | RuntimeException e) {
            return unavailable();
        }
    }

    @Override
    public Check check(String environmentId, String runId, String employeeId, String policyVersion, String orderUuid) {
        try (Connection c = dataSource.getConnection()) {
            Employee employee = employee(c, environmentId, runId, employeeId);
            if (employee == null) return new Check(Verdict.UNAVAILABLE, null);
            List<EligibleCandidates.Car> found = cars(c, "AND s.order_uuid = ?", environmentId, runId, orderUuid);
            if (found.isEmpty() || !visible(found.get(0).attributes(), employee.attributes(), employeeId)) {
                return new Check(Verdict.UNSUITABLE, null);
            }
            Brief brief = brief(c, environmentId, runId, employeeId);
            Optional<ClockReading> now = brief == null ? Optional.empty() : clock.read(environmentId, runId);
            if (brief == null || now.isEmpty()) return new Check(Verdict.UNAVAILABLE, null);
            if (!(evaluate(environmentId, runId, employeeId, policyVersion, employee, brief, now.get(), found)
                    instanceof EligibleCandidates.Evaluated evaluated)) {
                return new Check(Verdict.UNAVAILABLE, null);
            }
            for (EligibleCandidates.Decision d : evaluated.decisions()) {
                if (!orderUuid.equals(d.orderUuid()) || !"eligible".equals(d.gateStatus())) continue;
                ObjectNode remedy = CaseJson.obj().put("type", "alternative-car").put("orderUuid", orderUuid);
                String name = carName(d.quote());
                if (name != null) remedy.put("carName", name);
                return new Check(Verdict.SUITABLE, remedy);
            }
            return new Check(Verdict.UNSUITABLE, null);
        } catch (SQLException | RuntimeException e) {
            return new Check(Verdict.UNAVAILABLE, null);
        }
    }

    private EligibleCandidates.Result evaluate(String environmentId, String runId, String employeeId, String policyVersion,
            Employee employee, Brief brief, ClockReading now, List<EligibleCandidates.Car> cars) {
        String slotId = text(employee.attributes().get("entitlementSlotId"));
        return candidates.evaluate(new EligibleCandidates.Request(environmentId, runId, policyVersion, now.now(),
                now.clockVersion(), new EligibleCandidates.Subject(employeeId, slotId, employee.version(),
                        employee.attributes(), NullNode.instance, brief.version(), brief.content()), cars));
    }

    private static Options rows(List<EligibleCandidates.Car> visible, EligibleCandidates.Evaluated evaluated) {
        List<ObjectNode> items = new ArrayList<>();
        List<ObjectNode> unconfirmed = new ArrayList<>();
        Map<String, EligibleCandidates.Car> byUuid = new HashMap<>();
        for (EligibleCandidates.Car v : visible) byUuid.put(v.orderUuid(), v);
        for (EligibleCandidates.Decision d : evaluated.decisions()) {
            EligibleCandidates.Car car = byUuid.get(d.orderUuid());
            if (car == null || d.quote() == null || !d.quote().has("snapshot")) continue;
            ObjectNode row = CaseJson.obj().put("type", "alternative-car").put("orderUuid", car.orderUuid())
                    .put("configurationId", car.configurationId());
            row.set("snapshot", d.quote().get("snapshot").deepCopy());
            if ("eligible".equals(d.gateStatus())) {
                items.add(row);
            } else if (isEmpty(d.blockers()) && onlyBriefUnknowns(d.unknowns())) {
                Set<String> codes = new LinkedHashSet<>();
                d.unknowns().forEach(u -> codes.add(u.path("code").asText()));
                codes.forEach(row.putArray("unknowns")::add);
                unconfirmed.add(row);
            }
        }
        Comparator<ObjectNode> byId = Comparator.comparing(n -> n.get("orderUuid").asText());
        items.sort(byId);
        unconfirmed.sort(byId);
        return new Options(true, items, unconfirmed);
    }

    private static boolean isEmpty(JsonNode n) {
        return n == null || n.isNull() || (n.isArray() && n.isEmpty());
    }

    private static boolean onlyBriefUnknowns(JsonNode unknowns) {
        if (unknowns == null || !unknowns.isArray() || unknowns.isEmpty()) return false;
        for (JsonNode u : unknowns) if (!BRIEF_UNKNOWN.equals(u.path("code").asText())) return false;
        return true;
    }

    /** Server-derived from the checked snapshot, never from the client. */
    private static String carName(JsonNode quote) {
        JsonNode name = quote == null ? null : quote.path("snapshot").path("display").get("name");
        if (name == null || !name.isTextual() || name.textValue().trim().isEmpty()) return null;
        String trimmed = name.textValue().trim();
        return trimmed.length() > 200 ? trimmed.substring(0, 200) : trimmed;
    }

    private static Options unavailable() {
        return new Options(false, List.of(), List.of());
    }

    private static Employee employee(Connection c, String environmentId, String runId, String employeeId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT version, attributes::text FROM employees "
                + "WHERE environment_id = ? AND run_id = ? AND employee_id = ?")) {
            bind(ps, environmentId, runId, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? new Employee(rs.getLong(1), json(rs.getString(2))) : null;
            }
        }
    }

    private static Brief brief(Connection c, String environmentId, String runId, String employeeId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT h.brief_version, b.content::text FROM brief_heads h "
                + "JOIN briefs b ON b.environment_id = h.environment_id AND b.run_id = h.run_id "
                + "AND b.employee_id = h.employee_id AND b.brief_version = h.brief_version "
                + "WHERE h.environment_id = ? AND h.run_id = ? AND h.employee_id = ? AND h.brief_version > 0")) {
            bind(ps, environmentId, runId, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? new Brief(rs.getLong(1), json(rs.getString(2))) : null;
            }
        }
    }

    /** Released cars nobody occupies or holds as allocated; tail adds the key filter, order and limit. */
    private static List<EligibleCandidates.Car> cars(Connection c, String tail, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(COLUMNS + FREE + " " + tail)) {
            bind(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                List<EligibleCandidates.Car> out = new ArrayList<>();
                while (rs.next()) {
                    out.add(new EligibleCandidates.Car(rs.getString(1), rs.getString(2), rs.getLong(3), json(rs.getString(4))));
                }
                return out;
            }
        }
    }

    private static void bind(PreparedStatement ps, Object... params) throws SQLException {
        for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
    }

    private static JsonNode json(String text) throws SQLException {
        try {
            return CaseJson.M.readTree(text);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new SQLException("Unreadable stored JSON", e);
        }
    }

    /** The same visibility rule allocation applies: company, scheme and optional employee lists on the car. */
    private static boolean visible(JsonNode car, JsonNode employee, String employeeId) {
        JsonNode v = car.get("visibility");
        if (v == null || !v.isObject() || !includes(v.get("companyIds"), text(employee.get("companyId")))
                || !includes(v.get("schemeIds"), text(employee.get("schemeId")))) {
            return false;
        }
        JsonNode only = v.get("employeeIds");
        return only == null || only.isNull() || includes(only, employeeId);
    }

    private static boolean includes(JsonNode array, String value) {
        if (array == null || !array.isArray() || value == null) return false;
        for (JsonNode n : array) if (n.isTextual() && n.textValue().equals(value)) return true;
        return false;
    }

    private static String text(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank() ? n.textValue() : null;
    }
}
