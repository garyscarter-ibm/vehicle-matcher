package gcsp.api.clock;

/** Work delivered on a tick, outside any transaction: a unique id matching ^[a-z0-9][a-z0-9-]*$ and a policy stage. */
public interface TickHandler {

    String handlerId();

    String stage();

    HandlerOutcome handle(TickRequest request);
}
