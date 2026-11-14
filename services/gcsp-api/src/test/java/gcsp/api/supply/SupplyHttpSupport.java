package gcsp.api.supply;

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

/** Shared helpers: the app database is reused across test classes and runs, so clocks and ids are relative. */
final class SupplyHttpSupport {

    static final String BASE = "/api/gcsp/v1/presenter/releases";
    static final Instant FIRST = Instant.parse("2026-11-05T09:00:00Z");

    /** The next valid tick position for the active run: version above the top and a later instant. */
    record Clock(long version, Instant now) {
        Clock next() {
            return new Clock(version + 1, now.plusSeconds(60));
        }
    }

    private SupplyHttpSupport() {}

    static RequestSpecification presenter() {
        return given().header("Authorization", "Bearer " + SupplyHttpProfile.TOKEN)
                .contentType("application/json");
    }

    static String tickId() {
        return "http-" + UUID.randomUUID();
    }

    static String tickBody(String tickId, Clock c) {
        return "{\"tickId\":\"" + tickId + "\",\"now\":\"" + c.now() + "\",\"clockVersion\":" + c.version() + "}";
    }

    static Clock nextClock(AgroalDataSource ds, Persistence persistence) throws SQLException {
        EnvironmentGuard.RunState run = persistence.guard().currentRun();
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT clock_version, tick_now FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                        + "ORDER BY clock_version DESC, delivered_seq DESC LIMIT 1")) {
            ps.setString(1, run.environmentId());
            ps.setString(2, run.runId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return new Clock(1, FIRST);
                Instant top = rs.getObject(2, OffsetDateTime.class).toInstant();
                return new Clock(rs.getLong(1) + 1, top.isBefore(FIRST) ? FIRST : top.plusSeconds(60));
            }
        }
    }
}
