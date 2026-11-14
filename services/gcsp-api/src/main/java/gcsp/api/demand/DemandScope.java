package gcsp.api.demand;

/** The run a demand read covers and the policy version it is pinned to. */
public record DemandScope(String environmentId, String runId, String policyVersion) {}
