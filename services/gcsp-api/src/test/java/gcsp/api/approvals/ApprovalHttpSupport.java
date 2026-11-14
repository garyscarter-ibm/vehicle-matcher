package gcsp.api.approvals;

import static io.restassured.RestAssured.given;

import gcsp.api.persistence.EnvironmentGuard;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.restassured.specification.RequestSpecification;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.UUID;

/** Shared helpers: the database is reused across runs, so clocks and ids are relative to what it already holds. */
final class ApprovalHttpSupport {

    static final String PROGRESS = "/api/gcsp/v1/orders/progress";
    static final String TICKS = "/api/gcsp/v1/presenter/approvals/ticks";
    static final String RECONCILE = "/api/gcsp/v1/presenter/approvals/reconcile";
    private static final Instant FIRST = Instant.parse("2026-11-13T09:00:00Z");

    record Clock(long version, Instant now) {
        Clock next() {
            return new Clock(version + 1, now.plusSeconds(3600));
        }
    }

    private ApprovalHttpSupport() {}

    static RequestSpecification as() {
        return given().header("Authorization", "Bearer " + ApprovalHttpProfiles.TOKEN).contentType("application/json");
    }

    static String uuid() {
        return "ord-http-" + UUID.randomUUID();
    }

    static String tickBody(String tickId, Clock c) {
        return "{\"commandId\":\"cmd-" + tickId + "\",\"tickId\":\"" + tickId + "\",\"now\":\"" + c.now()
                + "\",\"clockVersion\":" + c.version() + "}";
    }

    /** The next valid tick position for the active run. */
    static Clock nextClock(AgroalDataSource ds, Persistence persistence) throws SQLException {
        EnvironmentGuard.RunState run = persistence.guard().currentRun();
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT clock_version, now FROM approval_ticks WHERE environment_id = ? AND run_id = ? "
                        + "ORDER BY clock_version DESC, created_at DESC LIMIT 1")) {
            ps.setString(1, run.environmentId());
            ps.setString(2, run.runId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return new Clock(1, FIRST);
                Instant top = rs.getObject(2, OffsetDateTime.class).toInstant();
                return new Clock(rs.getLong(1) + 1, top.isBefore(FIRST) ? FIRST : top.plusSeconds(3600));
            }
        }
    }
}
