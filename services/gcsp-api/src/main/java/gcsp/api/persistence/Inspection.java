package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;

/** What the receipt table says about a command id after an uncertain outcome. */
public sealed interface Inspection {

    record Committed(JsonNode result, long runRevision) implements Inspection {}

    /** No receipt: the command did not commit, so resubmitting is safe. */
    record Absent() implements Inspection {}

    record Unavailable(String message) implements Inspection {}
}
