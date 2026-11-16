package gcsp.api.clock;

import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.Function;

/** A tick handler that counts and records its calls and answers from a script. */
final class FakeHandler implements TickHandler {

    /** Call order across every fake, for ordering assertions. */
    static final List<String> LOG = Collections.synchronizedList(new ArrayList<>());

    final String id;
    final String stage;
    volatile Function<TickRequest, HandlerOutcome> behaviour = r -> new HandlerOutcome.Ok(TextNode.valueOf("done"));
    final List<TickRequest> requests = Collections.synchronizedList(new ArrayList<>());

    FakeHandler(String id, String stage) {
        this.id = id;
        this.stage = stage;
    }

    FakeHandler then(Function<TickRequest, HandlerOutcome> next) {
        behaviour = next;
        return this;
    }

    int calls() {
        return requests.size();
    }

    @Override
    public String handlerId() {
        return id;
    }

    @Override
    public String stage() {
        return stage;
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        requests.add(request);
        LOG.add(id);
        return behaviour.apply(request);
    }
}
