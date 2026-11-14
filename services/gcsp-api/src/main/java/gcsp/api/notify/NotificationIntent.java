package gcsp.api.notify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Tx;
import java.nio.charset.StandardCharsets;

/** The durable notification intent: an outbox row emitted inside the business command, so it commits with it. */
public final class NotificationIntent {

    public static final String OFFER_EVENT_TYPE = "notification.offer.v1";
    private static final ObjectMapper JSON = new ObjectMapper();

    private NotificationIntent() {}

    /** One notification per offer: a second intent for the same offer is a duplicate-record conflict. */
    public static void offer(Tx tx, String offerId, String recipientEmployeeId) {
        requireId("offerId", offerId);
        requireId("recipientEmployeeId", recipientEmployeeId);
        ObjectNode payload = JSON.createObjectNode()
                .put("messageKind", "offer")
                .put("messageVersion", "1")
                .put("offerId", offerId)
                .put("recipientEmployeeId", recipientEmployeeId)
                .put("offerLink", "/gcsp/offers/" + segment(offerId));
        tx.emit("notification:offer:" + offerId + ":v1", OFFER_EVENT_TYPE, payload);
    }

    /** Percent-encodes one RFC 3986 path segment; only unreserved characters stay literal. */
    static String segment(String value) {
        StringBuilder sb = new StringBuilder();
        for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xff;
            boolean unreserved = c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9'
                    || c == '-' || c == '.' || c == '_' || c == '~';
            if (unreserved) sb.append((char) c);
            else sb.append('%').append("0123456789ABCDEF".charAt(c >> 4)).append("0123456789ABCDEF".charAt(c & 15));
        }
        return sb.toString();
    }

    private static void requireId(String name, String value) {
        if (value == null || value.isBlank() || value.length() > 128 || value.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(name + " must be 1 to 128 characters without control characters");
        }
    }
}
