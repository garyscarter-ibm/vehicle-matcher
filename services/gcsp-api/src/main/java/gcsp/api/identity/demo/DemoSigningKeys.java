package gcsp.api.identity.demo;

import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Base64;
import javax.sql.DataSource;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.JsonWebKeySet;
import org.jose4j.jwk.PublicJsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jwk.RsaJwkGenerator;
import org.jose4j.lang.JoseException;

/** The issuer's one persisted RS256 signing key, so an ordinary restart keeps every token and session valid. */
public final class DemoSigningKeys {

    private final String kid;
    private final PrivateKey privateKey;
    private final String jwksJson;

    private DemoSigningKeys(String kid, PrivateKey privateKey, String jwksJson) {
        this.kid = kid;
        this.privateKey = privateKey;
        this.jwksJson = jwksJson;
    }

    public String kid() {
        return kid;
    }

    public PrivateKey privateKey() {
        return privateKey;
    }

    /** {"keys":[{kty,n,e,kid,use:"sig",alg:"RS256"}]}, the public half only. */
    public String jwksJson() {
        return jwksJson;
    }

    /** Loads the active key, or generates and stores one when there is none; two racing instances end with the same key. */
    public static DemoSigningKeys load(DataSource source) {
        try (Connection c = source.getConnection()) {
            Stored stored = readActive(c);
            if (stored == null) {
                insertIfAbsent(c, generate());
                stored = readActive(c);
            }
            if (stored == null) {
                throw new IllegalStateException("The demo sign-in signing key could not be stored");
            }
            return from(stored.kid(), stored.privateKey(), stored.publicJwk());
        } catch (SQLException e) {
            throw new IllegalStateException("The demo sign-in signing key could not be read (SQLState "
                    + e.getSQLState() + ")");
        }
    }

    /** A fresh in-memory key, for tests that need no database. */
    static DemoSigningKeys ephemeral() {
        Stored s = generate();
        return from(s.kid(), s.privateKey(), s.publicJwk());
    }

    private record Stored(String kid, String privateKey, String publicJwk) {}

    private static Stored generate() {
        try {
            RsaJsonWebKey key = RsaJwkGenerator.generateJwk(2048);
            key.setKeyId(key.calculateBase64urlEncodedThumbprint("SHA-256"));
            key.setUse("sig");
            key.setAlgorithm("RS256");
            return new Stored(key.getKeyId(),
                    Base64.getEncoder().encodeToString(key.getPrivateKey().getEncoded()),
                    key.toJson(JsonWebKey.OutputControlLevel.PUBLIC_ONLY));
        } catch (JoseException e) {
            throw new IllegalStateException("A demo sign-in signing key could not be generated");
        }
    }

    private static DemoSigningKeys from(String kid, String privateKeyBase64, String publicJwk) {
        try {
            PrivateKey priv = KeyFactory.getInstance("RSA").generatePrivate(
                    new PKCS8EncodedKeySpec(Base64.getDecoder().decode(privateKeyBase64)));
            PublicJsonWebKey pub = (PublicJsonWebKey) JsonWebKey.Factory.newJwk(publicJwk);
            return new DemoSigningKeys(kid, priv, new JsonWebKeySet(pub).toJson(JsonWebKey.OutputControlLevel.PUBLIC_ONLY));
        } catch (GeneralSecurityException | JoseException | IllegalArgumentException e) {
            throw new IllegalStateException("The stored demo sign-in signing key is unreadable");
        }
    }

    private static Stored readActive(Connection c) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT kid, private_key_pkcs8, public_jwk FROM demo_idp_signing_keys WHERE active");
                ResultSet rs = ps.executeQuery()) {
            return rs.next() ? new Stored(rs.getString(1), rs.getString(2), rs.getString(3)) : null;
        }
    }

    /** The one-active-key unique index makes a racing second insert a no-op. */
    private static void insertIfAbsent(Connection c, Stored s) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO demo_idp_signing_keys "
                + "(kid, private_key_pkcs8, public_jwk) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")) {
            ps.setString(1, s.kid());
            ps.setString(2, s.privateKey());
            ps.setString(3, s.publicJwk());
            ps.executeUpdate();
        }
    }
}
