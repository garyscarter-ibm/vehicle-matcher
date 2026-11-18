package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import javax.sql.DataSource;

/**
 * Unmet-demand evaluation over the selected EligibleCandidates engine (Node server/gcsp/greg/index.js lines 84-120):
 * one engine call per brief over batched reads. Any failure or gap is UNAVAILABLE, never a guess.
 */
@ApplicationScoped
public class RecommendationUnmetEvaluation implements UnmetEvaluationPort {

    static final String EMPLOYEES = "SELECT employee_id, version, attributes::text FROM employees WHERE environment_id = ? "
            + "AND run_id = ? AND employee_id = ANY(?)";
    static final String ACCOUNTS = "SELECT employee_id, record::text FROM employee_account_records WHERE environment_id = ? "
            + "AND run_id = ? AND employee_id = ANY(?)";
    static final String CARS = "SELECT order_uuid, configuration_id, version, attributes::text FROM stock_cars "
            + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ANY(?)";
    private static final ObjectMapper JSON = new ObjectMapper();

    @Inject
    EligibleCandidates candidates;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    /** Set by tests to read from a plain datasource. */
    Supplier<DataSource> source;

    private record Employee(long version, JsonNode attributes) {}

    @Override
    public Evaluation evaluate(DemandScope scope, List<BriefCandidate> briefs, Instant asOf, long clockVersion) {
        try {
            DataSource ds = source != null ? source.get() : persistence.active() ? dataSource.get() : null;
            if (ds == null || clockVersion <= 0) return Evaluation.UNAVAILABLE;
            Map<String, Employee> employees;
            Map<String, JsonNode> accounts;
            Map<String, EligibleCandidates.Car> cars;
            try (Connection c = ds.getConnection()) {
                boolean auto = c.getAutoCommit();
                boolean readOnly = c.isReadOnly();
                try {
                    c.setAutoCommit(false);
                    c.setReadOnly(true);
                    Set<String> employeeIds = new LinkedHashSet<>();
                    Set<String> orderUuids = new LinkedHashSet<>();
                    for (BriefCandidate b : briefs) {
                        employeeIds.add(b.employeeId());
                        b.cars().forEach(k -> orderUuids.add(k.orderUuid()));
                    }
                    employees = employees(c, scope, employeeIds);
                    accounts = accounts(c, scope, employeeIds);
                    cars = cars(c, scope, orderUuids);
                } finally {
                    try {
                        c.rollback();
                    } finally {
                        c.setReadOnly(readOnly);
                        c.setAutoCommit(auto);
                    }
                }
            }
            Map<String, List<CarDecision>> out = new LinkedHashMap<>();
            for (BriefCandidate b : briefs) {
                List<CarDecision> decisions = brief(scope, asOf, clockVersion, b, employees, accounts, cars);
                if (decisions == null) return Evaluation.UNAVAILABLE;
                out.put(b.employeeId(), decisions);
            }
            return new Evaluation.Ok(out);
        } catch (Exception e) {
            return Evaluation.UNAVAILABLE;
        }
    }

    private List<CarDecision> brief(DemandScope scope, Instant asOf, long clockVersion, BriefCandidate b,
            Map<String, Employee> employees, Map<String, JsonNode> accounts, Map<String, EligibleCandidates.Car> cars) {
        Employee e = employees.get(b.employeeId());
        if (e == null || !e.attributes().path("entitlementSlotId").isTextual()) return null;
        List<EligibleCandidates.Car> visible = new ArrayList<>();
        for (CarCandidate k : b.cars()) {
            EligibleCandidates.Car car = cars.get(k.orderUuid());
            if (car == null) return null;
            visible.add(car);
        }
        EligibleCandidates.Subject subject = new EligibleCandidates.Subject(b.employeeId(),
                e.attributes().get("entitlementSlotId").asText(), e.version(), e.attributes(),
                accounts.getOrDefault(b.employeeId(), NullNode.instance), b.briefVersion(), b.content());
        EligibleCandidates.Result result = candidates.evaluate(new EligibleCandidates.Request(scope.environmentId(),
                scope.runId(), scope.policyVersion(), asOf, clockVersion, subject, visible));
        if (!(result instanceof EligibleCandidates.Evaluated evaluated)) return null;
        Map<String, EligibleCandidates.Decision> byCar = new HashMap<>();
        for (EligibleCandidates.Decision d : evaluated.decisions()) {
            if (d == null || byCar.put(d.orderUuid(), d) != null) return null;
        }
        List<CarDecision> out = new ArrayList<>();
        for (CarCandidate k : b.cars()) {
            EligibleCandidates.Decision d = byCar.get(k.orderUuid());
            if (d == null || d.gateStatus() == null) return null;
            List<Gate> blockers = gates(d.blockers());
            String status = d.gateStatus();
            if ("unavailable".equals(k.availabilityState())) {
                status = "ineligible";
                if (blockers.stream().noneMatch(g -> "not-available".equals(g.code()))) blockers.add(new Gate("not-available", null));
            }
            out.add(new CarDecision(k.orderUuid(), status, blockers, gates(d.unknowns()), d.score()));
        }
        return out;
    }

    private static List<Gate> gates(JsonNode array) {
        List<Gate> out = new ArrayList<>();
        if (array == null || array.isNull()) return out;
        if (!array.isArray()) throw new IllegalStateException("gates are not an array");
        for (JsonNode g : array) {
            if (!g.path("code").isTextual()) throw new IllegalStateException("gate has no code");
            JsonNode field = g.get("field");
            out.add(new Gate(g.get("code").asText(), field != null && field.isTextual() ? field.asText() : null));
        }
        return out;
    }

    private static Map<String, Employee> employees(Connection c, DemandScope s, Set<String> ids) throws SQLException {
        Map<String, Employee> out = new HashMap<>();
        try (PreparedStatement ps = prepare(c, EMPLOYEES, s, ids); ResultSet rs = ps.executeQuery()) {
            while (rs.next()) out.put(rs.getString(1), new Employee(rs.getLong(2), json(rs.getString(3))));
        }
        return out;
    }

    private static Map<String, JsonNode> accounts(Connection c, DemandScope s, Set<String> ids) throws SQLException {
        Map<String, JsonNode> out = new HashMap<>();
        try (PreparedStatement ps = prepare(c, ACCOUNTS, s, ids); ResultSet rs = ps.executeQuery()) {
            while (rs.next()) out.put(rs.getString(1), json(rs.getString(2)));
        }
        return out;
    }

    private static Map<String, EligibleCandidates.Car> cars(Connection c, DemandScope s, Set<String> ids) throws SQLException {
        Map<String, EligibleCandidates.Car> out = new HashMap<>();
        try (PreparedStatement ps = prepare(c, CARS, s, ids); ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                out.put(rs.getString(1), new EligibleCandidates.Car(rs.getString(1), rs.getString(2), rs.getLong(3), json(rs.getString(4))));
            }
        }
        return out;
    }

    private static PreparedStatement prepare(Connection c, String sql, DemandScope s, Set<String> ids) throws SQLException {
        PreparedStatement ps = c.prepareStatement(sql);
        ps.setString(1, s.environmentId());
        ps.setString(2, s.runId());
        ps.setArray(3, c.createArrayOf("text", new HashSet<>(ids).toArray()));
        return ps;
    }

    private static JsonNode json(String text) throws SQLException {
        try {
            return JSON.readTree(text);
        } catch (java.io.IOException e) {
            throw new SQLException(e);
        }
    }
}
