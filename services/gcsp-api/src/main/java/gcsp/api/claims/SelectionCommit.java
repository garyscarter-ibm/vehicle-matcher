package gcsp.api.claims;

import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;

/** Ordering's own write, run inside the allocation transaction; a refusal or exception rolls both back. */
@FunctionalInterface
public interface SelectionCommit {

    WorkResult run(Tx tx) throws Exception;
}
