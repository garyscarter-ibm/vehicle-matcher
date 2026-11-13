package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;

/** A client command: its type, caller-chosen id (the idempotency key) and input (digested for replay checks). */
public record Command(String type, String commandId, JsonNode input) {}
