package gcsp.api.appointments;

import static io.restassured.RestAssured.given;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** Shared HTTP helpers: real RS256 tokens for the four accounts and relative clocks, since the database is reused. */
final class ApptHttp {

    static final String BASE = "/api/gcsp/v1";
    static final ObjectMapper JSON = new ObjectMapper();
    static final Instant FIRST = Instant.parse("2026-11-05T09:00:00Z");

    private final RsaJsonWebKey key;

    ApptHttp(String signingJwk) throws Exception {
        key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
    }

    String token(String subject, String role) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(ApptHttpProfiles.ISSUER);
        c.setAudience(ApptHttpProfiles.AUDIENCE);
        c.setSubject(subject);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", ApptHttpProfiles.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    RequestSpecification as(String who) throws Exception {
        String token = switch (who) {
            case "paula" -> token("sub-paula", "employee");
            case "alex" -> token("sub-alex", "employee");
            case "greg" -> token("sub-greg", "greg");
            case "presenter" -> token("sub-presenter", "presenter");
            default -> throw new IllegalArgumentException(who);
        };
        return given().header("Authorization", "Bearer " + token).contentType("application/json");
    }

    static JsonNode body(Response r) throws Exception {
        return JSON.readTree(r.asString());
    }

    static String id() {
        return UUID.randomUUID().toString();
    }

    /** One second after the run's latest tick (or the first demo day): ticks may never go backwards. */
    static Instant nextTick(AgroalDataSource ds, Persistence persistence) throws Exception {
        var run = persistence.guard().currentRun();
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT max(tick_now) FROM appointment_ticks WHERE environment_id = ? AND run_id = ?")) {
            ps.setString(1, run.environmentId());
            ps.setString(2, run.runId());
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                OffsetDateTime top = rs.getObject(1, OffsetDateTime.class);
                return top == null || top.toInstant().isBefore(FIRST) ? FIRST : top.toInstant().plusSeconds(1);
            }
        }
    }

    static long count(AgroalDataSource ds, String sql, Object... params) throws Exception {
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }
}
