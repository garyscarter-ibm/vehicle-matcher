package gcsp.api.identity.demo;

import jakarta.enterprise.context.ApplicationScoped;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory, single-use sign-in transactions (10 minutes) and authorization codes (60 seconds). A restart loses
 * them, which only means choosing a person again.
 */
@ApplicationScoped
public class DemoGrants {

    /** An authorization request waiting for a person to be chosen. */
    public record Txn(String redirectUri, String challenge, String state, String nonce, Instant expires) {}

    /** A minted authorization code and what it is bound to. */
    public record Code(String clientId, String redirectUri, String challenge, String nonce, String subject,
            String sessionId, Instant authTime, Instant expires) {}

    static final Duration TXN_LIFETIME = Duration.ofMinutes(10);
    static final Duration CODE_LIFETIME = Duration.ofSeconds(60);
    private static final int MAX_PENDING = 5000;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Clock clock = Clock.systemUTC();
    private final Map<String, Txn> txns = new ConcurrentHashMap<>();
    private final Map<String, Code> codes = new ConcurrentHashMap<>();

    /** Holds a transaction and returns its random id; at the cap the oldest waiting one is dropped, so floods can't lock sign-in. */
    public Optional<String> openTxn(String redirectUri, String challenge, String state, String nonce) {
        Instant now = clock.instant();
        txns.values().removeIf(t -> t.expires().isBefore(now));
        while (txns.size() >= MAX_PENDING) {
            txns.entrySet().stream().min(java.util.Map.Entry.comparingByValue(
                    java.util.Comparator.comparing(Txn::expires))).ifPresent(e -> txns.remove(e.getKey(), e.getValue()));
        }
        String id = random(24);
        txns.put(id, new Txn(redirectUri, challenge, state, nonce, now.plus(TXN_LIFETIME)));
        return Optional.of(id);
    }

    /** The live transaction, without spending it. */
    public Optional<Txn> peekTxn(String id) {
        Txn t = id == null ? null : txns.get(id);
        return t != null && t.expires().isAfter(clock.instant()) ? Optional.of(t) : Optional.empty();
    }

    /** Spends a transaction; true for exactly one caller. */
    public boolean spendTxn(String id, Txn txn) {
        return txns.remove(id, txn);
    }

    /** Mints a one-use code (random, 32 bytes). */
    public String mintCode(String clientId, Txn txn, String subject, DemoSessions.Session session) {
        Instant now = clock.instant();
        codes.values().removeIf(c -> c.expires().isBefore(now));
        String code = random(32);
        codes.put(code, new Code(clientId, txn.redirectUri(), txn.challenge(), txn.nonce(), subject, session.id(),
                session.authTime(), now.plus(CODE_LIFETIME)));
        return code;
    }

    /** Takes a code out of the store, so it can never be used twice; empty when unknown, spent or expired. */
    public Optional<Code> takeCode(String code) {
        Code c = code == null ? null : codes.remove(code);
        return c != null && c.expires().isAfter(clock.instant()) ? Optional.of(c) : Optional.empty();
    }

    /** True when BASE64URL(SHA256(verifier)) equals the stored challenge. */
    static boolean pkceMatches(String verifier, String challenge) {
        if (verifier == null || verifier.isBlank()) {
            return false;
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            String computed = Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
            return MessageDigest.isEqual(computed.getBytes(StandardCharsets.US_ASCII),
                    challenge.getBytes(StandardCharsets.US_ASCII));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String random(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }
}
