package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.scenario.DemoPreparationFile;
import java.io.IOException;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Test-only: the demo people as a differently shaped HR export, with the slot timestamps the database holds. */
final class AccountDevCompositionSupport {

    static final List<String> EMPLOYEES = List.of("paula", "alex", "sam", "jordan");
    private static final DateTimeFormatter MILLIS_Z = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
    private static final String EPOCH = "2026-11-05T09:00:00.000Z";

    private AccountDevCompositionSupport() {}

    /** employeeId to the flat slots (the records shape) the repository would serve; timestamps are a placeholder. */
    static Map<String, ArrayNode> slotsFromFile() {
        Map<String, ArrayNode> out = new LinkedHashMap<>();
        for (JsonNode p : DemoPreparationFile.load().principals()) {
            ArrayNode slots = GoldenFixture.JSON.createArrayNode();
            for (JsonNode s : p.get("slots")) {
                ObjectNode slot = GoldenFixture.JSON.createObjectNode();
                slot.put("entitlementSlotId", s.get("slotId").textValue()).put("capacity", s.get("capacity").intValue());
                s.get("attributes").fields().forEachRemaining(e -> slot.set(e.getKey(), e.getValue()));
                slot.set("version", s.get("version"));
                slot.put("createdAt", EPOCH).put("updatedAt", EPOCH);
                slots.add(slot);
            }
            out.put(p.get("employeeId").textValue(), slots);
        }
        return out;
    }

    /** The same slots with the created and updated instants the database stamped at seeding. */
    static Map<String, ArrayNode> slotsFromDatabase(Connection c) throws SQLException {
        Map<String, ArrayNode> out = slotsFromFile();
        try (PreparedStatement ps = c.prepareStatement("SELECT employee_id, slot_id, created_at, updated_at FROM entitlement_slots "
                + "WHERE environment_id = ? AND run_id = ?")) {
            ps.setString(1, AccountDevCompositionProfiles.ENV);
            ps.setString(2, AccountDevCompositionProfiles.RUN);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    for (JsonNode slot : out.get(rs.getString(1))) {
                        if (!slot.get("entitlementSlotId").textValue().equals(rs.getString(2))) continue;
                        ((ObjectNode) slot).put("createdAt", iso(rs.getObject(3, OffsetDateTime.class)));
                        ((ObjectNode) slot).put("updatedAt", iso(rs.getObject(4, OffsetDateTime.class)));
                    }
                }
            }
        }
        return out;
    }

    static String token(String signingJwk, String sub, String role) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(AccountHttpProfile.ISSUER);
        c.setAudience(AccountHttpProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", AccountHttpProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(((RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk)).getPrivateKey());
        jws.setKeyIdHeaderValue(AccountHttpProfile.KID);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private static String iso(OffsetDateTime t) {
        return MILLIS_Z.format(t.withOffsetSameInstant(ZoneOffset.UTC));
    }

    static void dropSchema(String schema) throws Exception {
        if (schema == null || !schema.startsWith("gcsp_s_acctdev_")) return;
        org.postgresql.ds.PGSimpleDataSource ds = new org.postgresql.ds.PGSimpleDataSource();
        ds.setUrl(AccountDevCompositionProfiles.URL);
        try (Connection c = ds.getConnection(); java.sql.Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    static void writeExport(Path file, Map<String, ArrayNode> slots) throws IOException {
        List<ObjectNode> people = new ArrayList<>();
        for (JsonNode p : DemoPreparationFile.load().principals()) {
            String id = p.get("employeeId").textValue();
            if (!id.startsWith("employee-")) continue;
            people.add(HrExportFixture.person(id, p.get("companyId").textValue(), p.get("schemeId").textValue(),
                    p.get("gradeId").textValue(), p.get("entitlementSlotId").textValue(), p.get("record"), slots.get(id),
                    p.get("recordVersion")));
        }
        HrExportFixture.write(file, HrExportFixture.export(AccountDevCompositionProfiles.ENV, AccountDevCompositionProfiles.RUN,
                EPOCH, people));
    }
}
