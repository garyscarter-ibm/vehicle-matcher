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

    /** Delivers a completed tick that moves the run's demo clock on by the given seconds; returns the new clock. */
    static Instant tick(AgroalDataSource ds, Persistence persistence, long plusSeconds) throws SQLException {
        EnvironmentGuard.RunState run = persistence.guard().currentRun();
        try (Connection c = ds.getConnection()) {
            long version = 1;
            Instant top = FIRST;
            try (PreparedStatement ps = c.prepareStatement("SELECT clock_version, tick_now FROM supply_release_ticks "
                    + "WHERE environment_id = ? AND run_id = ? ORDER BY clock_version DESC, delivered_seq DESC LIMIT 1")) {
                ps.setString(1, run.environmentId());
                ps.setString(2, run.runId());
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        version = rs.getLong(1) + 1;
                        Instant t = rs.getObject(2, OffsetDateTime.class).toInstant();
                        if (t.isAfter(FIRST)) top = t;
                    }
                }
            }
            Instant now = top.plusSeconds(plusSeconds);
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO supply_release_ticks (environment_id, run_id, "
                    + "tick_id, tick_now, clock_version, input_digest, state, last_outcome) "
                    + "VALUES (?, ?, ?, ?, ?, ?, 'completed', '{}'::jsonb)")) {
                ps.setString(1, run.environmentId());
                ps.setString(2, run.runId());
                ps.setString(3, "ret-http-" + UUID.randomUUID());
                ps.setObject(4, now.atOffset(ZoneOffset.UTC));
                ps.setLong(5, version);
                ps.setString(6, "0".repeat(64));
                ps.executeUpdate();
            }
            return now;
        }
    }
}
