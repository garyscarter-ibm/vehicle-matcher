package gcsp.api.persistence;

/** The environment, run and actor a command is scoped to; every row and receipt key carries all three. */
public record RunContext(String environmentId, String runId, String actorId) {}
