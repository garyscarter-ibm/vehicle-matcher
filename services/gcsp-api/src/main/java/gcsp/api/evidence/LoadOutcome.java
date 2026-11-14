package gcsp.api.evidence;

/** load() result: status "ok" or "source-unavailable"; recovered means a fallback is active and failure says why. */
public record LoadOutcome(String status, CorpusFailure failure, boolean recovered, ActiveInfo active) {

    public boolean ready() {
        return active != null;
    }
}
