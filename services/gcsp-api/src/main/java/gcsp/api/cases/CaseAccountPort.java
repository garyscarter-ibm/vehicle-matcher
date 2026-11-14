package gcsp.api.cases;

/** The employee's current renewal context as the account records give it; no decisions. */
public interface CaseAccountPort {

    /** ok with possibly null fields (the account has no renewal or no dated contract), or unavailable. */
    record Lookup(boolean ok, String name, String renewalId, String contractEndDate) {

        public static Lookup ok(String name, String renewalId, String contractEndDate) {
            return new Lookup(true, name, renewalId, contractEndDate);
        }

        public static Lookup unavailable() {
            return new Lookup(false, null, null, null);
        }
    }

    Lookup renewal(String environmentId, String runId, String employeeId);
}
