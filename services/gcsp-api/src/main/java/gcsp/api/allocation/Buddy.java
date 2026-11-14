package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;

/** Small shared predicates over Buddy permissions and JSON text. */
final class Buddy {

    static final String OCCUPYING = "('active', 'claim-pending', 'release-pending', 'selection-pending')";

    private Buddy() {}

    /** Search and hold share one Buddy switch, so a partial grant is not engaged (copy of Engagement.engaged). */
    static boolean engaged(JsonNode buddy) {
        return buddy != null && flag(buddy, "searchConsent") && flag(buddy, "holdConsent")
                && buddy.path("paused").isBoolean() && !buddy.get("paused").booleanValue();
    }

    static boolean flag(JsonNode n, String field) {
        return n != null && n.path(field).isBoolean() && n.get(field).booleanValue();
    }

    /** The text of a non-blank textual node, else null. */
    static String text(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank() ? n.textValue() : null;
    }
}
