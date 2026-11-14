package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;

/** The typed answer of driving one remote Buddy operation. */
public sealed interface DriveResult {

    /** The operation is closed (acknowledged or refused), with its stored outcome. */
    record Settled(String state, JsonNode outcome) implements DriveResult {}

    /** The operation stays open and its custody is kept; driving it again resumes it. */
    record Pending(String code, String lastKnownState) implements DriveResult {}

    /** The operation cannot be driven (unknown operation, bad scope, or no remote). */
    record Refused(String code) implements DriveResult {}
}
