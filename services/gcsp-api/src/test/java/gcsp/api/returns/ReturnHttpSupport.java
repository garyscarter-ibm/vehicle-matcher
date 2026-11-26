package gcsp.api.returns;

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
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** Shared helpers: the database is reused across runs, so clocks and order ids are relative to what it holds. */
final class ReturnHttpSupport {

    static final String PLAN = "/api/gcsp/v1/return-plan";
    static final String REQUEST = PLAN + "/request";
    static final String ACCEPT = PLAN + "/accept";
    static final String PROGRESS = "/api/gcsp/v1/presenter/returns/progress";
    static final String EMPLOYEE_A = "E-1001";
    private static final Instant FIRST = Instant.parse("2026-11-05T09:00:00Z");
    private static final String SCENARIO_VERSION = "gcsp-clock-scenario-v1";
    private static final String FIXTURE_VERSION = "gcsp-clock-fixtures-v1";
    private static final String NAMED_TIMES = "{\"release\":\"2026-11-05T09:30:00Z\",\"expiry\":\"2026-11-05T11:00:00Z\"}";
    private static final DateTimeFormatter SLOT_ID = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmm'Z'").withZone(ZoneOffset.UTC);

    private ReturnHttpSupport() {}

    /** A signed RS256 bearer token for one of the profile's accounts. */
    static String token(String signingJwk, String subject, String role) {
        try {
            RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
            JwtClaims c = new JwtClaims();
            c.setIssuer(ReturnHttpProfiles.ISSUER);
            c.setAudience(ReturnHttpProfiles.AUDIENCE);
            c.setSubject(subject);
            c.setExpirationTimeMinutesInTheFuture(10);
            c.setIssuedAtToNow();
            c.setClaim("azp", ReturnHttpProfiles.CLIENT);
            c.setClaim("scope", "openid gcsp-api");
            c.setClaim("realm_access", Map.of("roles", List.of(role)));
            JsonWebSignature jws = new JsonWebSignature();
            jws.setPayload(c.toJson());
            jws.setKey(key.getPrivateKey());
            jws.setKeyIdHeaderValue(ReturnHttpProfiles.KID);
            jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
            return jws.getCompactSerialization();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static RequestSpecification as(String token) {
        return given().header("Authorization", "Bearer " + token).contentType("application/json");
    }

    static String orderId() {
        return "ord-ret-http-" + UUID.randomUUID();
    }

    /** A same-visit slot a few days after the demo clock, as the handover appointment. */
    static AppointmentSlot handoverSlot(Instant now) {
        Instant start = now.plus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
        return new AppointmentSlot("slot-" + SLOT_ID.format(start), start, start.plus(1, ChronoUnit.HOURS));
    }

    /** Advances the test run clock from the FUCQ-479 scenario time by the given seconds; returns the new clock. */
    static Instant tick(AgroalDataSource ds, Persistence persistence, long plusSeconds) throws SQLException {
        EnvironmentGuard.RunState run = persistence.guard().currentRun();
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            long version = 2;
            Instant top = FIRST;
            boolean exists = false;
            try (PreparedStatement ps = c.prepareStatement("SELECT clock_version, clock_instant FROM run_clocks "
                    + "WHERE environment_id = ? AND run_id = ? FOR UPDATE")) {
                ps.setString(1, run.environmentId());
                ps.setString(2, run.runId());
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        exists = true;
                        version = rs.getLong(1) + 1;
                        Instant t = rs.getObject(2, OffsetDateTime.class).toInstant();
                        if (t.isAfter(FIRST)) top = t;
                    }
                }
            }
            if (!exists) {
                try (PreparedStatement insert = c.prepareStatement("INSERT INTO run_clocks "
                        + "(environment_id, run_id, clock_instant, clock_version, scenario_version, "
                        + "fixture_version, starts_at, named_times) VALUES (?, ?, ?, 1, ?, ?, ?, ?::jsonb)")) {
                    insert.setString(1, run.environmentId());
                    insert.setString(2, run.runId());
                    insert.setObject(3, FIRST.atOffset(ZoneOffset.UTC));
                    insert.setString(4, SCENARIO_VERSION);
                    insert.setString(5, FIXTURE_VERSION);
                    insert.setObject(6, FIRST.atOffset(ZoneOffset.UTC));
                    insert.setString(7, NAMED_TIMES);
                    insert.executeUpdate();
                }
            }
            Instant now = top.plusSeconds(plusSeconds);
            try (PreparedStatement ps = c.prepareStatement("UPDATE run_clocks SET clock_instant = ?, clock_version = ?, "
                    + "last_tick_id = NULL, version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ?")) {
                ps.setObject(1, now.atOffset(ZoneOffset.UTC));
                ps.setLong(2, version);
                ps.setString(3, run.environmentId());
                ps.setString(4, run.runId());
                if (ps.executeUpdate() != 1) throw new SQLException("The run clock fixture was not updated.");
            }
            c.commit();
            return now;
        }
    }
}
