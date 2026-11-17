package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.post;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.scenario.DemoPreparationFile;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;

/** Assertions both composition phases make: nothing demo exists, and every reset is refused. */
final class PresenterCompositionChecks {

    private PresenterCompositionChecks() {}

    static void noDemoData(String schema) throws Exception {
        List<String> demo = new ArrayList<>();
        DemoPreparationFile.load().principals().forEach(p -> demo.add(p.get("employeeId").textValue()));
        try (Connection c = PresenterClockProfiles.plain().getConnection()) {
            c.createStatement().execute("SET search_path TO " + schema);
            try (ResultSet rs = c.createStatement().executeQuery("SELECT count(*) FROM scenario_runs")) {
                rs.next();
                assertEquals(0, rs.getLong(1), "scenario_runs");
            }
            for (String table : new String[] {"employees", "employee_account_records"}) {
                for (String id : demo) {
                    try (PreparedStatement ps = c.prepareStatement("SELECT count(*) FROM " + table + " WHERE employee_id = ?")) {
                        ps.setString(1, id);
                        try (ResultSet rs = ps.executeQuery()) {
                            rs.next();
                            assertEquals(0, rs.getLong(1), table + " " + id);
                        }
                    }
                }
            }
        }
    }

    static void resetRefused(String presenter, String employee) {
        for (String path : new String[] {"/scenarios/reset", "/clock/reset"}) {
            post(presenter, path, "{}").then().statusCode(403).body("code", equalTo("scenarios-not-configured"));
            post(employee, path, "{}").then().statusCode(403).body("code", equalTo("role-required"));
        }
    }
}
