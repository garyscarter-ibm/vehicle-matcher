package gcsp.api.evidence;

/** Node-compatible refusal; cause is the inner code, historyChanged marks a selection absent from history. */
public record CorpusFailure(String code, String message, String cause, boolean historyChanged) {

    public CorpusFailure(String code, String message) {
        this(code, message, null, false);
    }
}
