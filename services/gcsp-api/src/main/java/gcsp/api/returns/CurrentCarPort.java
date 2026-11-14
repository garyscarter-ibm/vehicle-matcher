package gcsp.api.returns;

import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import java.sql.SQLException;

/** The story's current-car state; FUCQ-458 may later hold an equivalent behind this interface. */
public interface CurrentCarPort {

    /** Applies one confirmed event inside the caller's transaction; a repeat is a no-op. */
    CurrentCarResult apply(Tx tx, CurrentCarEvent event, ReturnSource source) throws SQLException;

    /** Side-effect free: the recorded relationship, or the baseline the source implies. */
    CurrentCarView read(RunContext ctx, String orderUuid, ReturnSource source) throws SQLException;
}
