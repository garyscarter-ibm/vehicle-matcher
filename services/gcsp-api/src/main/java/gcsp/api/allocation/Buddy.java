package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.brief.Engagement;

/** Small shared predicates over Buddy permissions and JSON text. */
final class Buddy {

    static final String OCCUPYING = "('active', 'claim-pending', 'release-pending', 'selection-pending')";

    private Buddy() {}

    /** Search and hold share one Buddy switch, so a partial grant is not engaged. */
    static boolean engaged(JsonNode buddy) {
        return Engagement.engaged(buddy);
    }

    static boolean flag(JsonNode n, String field) {
        return n != null && n.path(field).isBoolean() && n.get(field).booleanValue();
    }

    /** The text of a non-blank textual node, else null. */
    static String text(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank() ? n.textValue() : null;
    }
}
