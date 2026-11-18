package gcsp.api.production;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import gcsp.api.persistence.Canonical;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** Deterministic ids: the first 32 hex characters of a digest over the named parts. */
final class Ids {

    private Ids() {}

    static String hex32(String... parts) {
        ArrayNode a = JsonNodeFactory.instance.arrayNode();
        for (String p : parts) a.add(p);
        return Canonical.digest(a).substring(0, 32);
    }

    /** Instants are kept at millisecond precision everywhere, as the Node lifecycle writes them. */
    static Instant ms(Instant t) {
        return t == null ? null : t.truncatedTo(ChronoUnit.MILLIS);
    }

    static Instant parse(String text) {
        if (text == null || text.isBlank()) return null;
        try {
            return Instant.parse(text);
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }
}
