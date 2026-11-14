package gcsp.api.policy;

/** Company, scheme and grade for a read. A null runId means the caller did not assert a run. */
public record PolicyContext(String runId, String companyId, String schemeId, String gradeId) {
}
