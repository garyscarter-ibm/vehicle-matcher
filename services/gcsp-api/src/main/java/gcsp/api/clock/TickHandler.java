package gcsp.api.clock;

/** Work delivered on a tick, outside any transaction: a unique id matching ^[a-z0-9][a-z0-9-]*$ and a policy stage. */
public interface TickHandler {

    String handlerId();

    String stage();

    HandlerOutcome handle(TickRequest request);

    /** False leaves the handler unregistered, so its stage is a missing stage (as Node, which registers only with a source). */
    default boolean enabled() {
        return true;
    }
}
