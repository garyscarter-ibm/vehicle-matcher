package gcsp.api.clock.bound;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import gcsp.api.clock.HandlerOutcome;

/** A startup tick leaves sibling work to the sibling's own startup reconciler. */
final class StartupSkip {

    static final HandlerOutcome OUTCOME = new HandlerOutcome.Ok(
            JsonNodeFactory.instance.objectNode().put("skipped", "startup-owned-by-service"));

    private StartupSkip() {}
}
