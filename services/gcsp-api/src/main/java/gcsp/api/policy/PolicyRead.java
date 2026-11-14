package gcsp.api.policy;

/** One policy read: run, instant and an optional pin. A null policyVersion means unpinned. */
public record PolicyRead(String runId, String asOf, String policyVersion) {
}
