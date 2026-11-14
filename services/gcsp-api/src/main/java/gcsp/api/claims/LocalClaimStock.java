package gcsp.api.claims;

/** Local mode: the claim finishes in its own transaction, so there is never a remote call to make. */
public final class LocalClaimStock implements ClaimStockPort {

    @Override
    public Mode mode() {
        return Mode.LOCAL;
    }

    @Override
    public Ack execute(Operation operation) {
        throw new UnsupportedOperationException("Local claims have no remote stock");
    }

    @Override
    public Ack reconcile(Operation operation) {
        throw new UnsupportedOperationException("Local claims have no remote stock");
    }
}
