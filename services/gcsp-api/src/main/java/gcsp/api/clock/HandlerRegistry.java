package gcsp.api.clock;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** The validated, immutable set of registered tick handlers. */
final class HandlerRegistry {

    private static final Pattern ID = Pattern.compile("^[a-z0-9][a-z0-9-]*$");

    private final Map<String, TickHandler> byId;

    private HandlerRegistry(Map<String, TickHandler> byId) {
        this.byId = byId;
    }

    /** Throws IllegalArgumentException with a clear message for a bad id, a missing stage or a duplicate id. */
    static HandlerRegistry of(List<TickHandler> handlers) {
        Map<String, TickHandler> map = new HashMap<>();
        for (TickHandler handler : handlers == null ? List.<TickHandler>of() : handlers) {
            if (handler == null) throw new IllegalArgumentException("A clock handler registration is null.");
            String id = handler.handlerId();
            if (id == null || !ID.matcher(id).matches()) {
                throw new IllegalArgumentException("Clock handler id '" + id
                        + "' is invalid: use lowercase letters, digits and hyphens, starting with a letter or digit.");
            }
            if (!Instants.text(handler.stage(), 128)) {
                throw new IllegalArgumentException("Clock handler '" + id + "' has no stage.");
            }
            if (map.put(id, handler) != null) {
                throw new IllegalArgumentException("Clock handler id '" + id + "' is registered more than once.");
            }
        }
        return new HandlerRegistry(Map.copyOf(map));
    }

    TickHandler find(String handlerId) {
        return byId.get(handlerId);
    }

    /** A clear message for the first handler whose stage the policy does not define, else null. */
    String firstUnknownStage(List<String> stages) {
        for (TickHandler handler : byId.values()) {
            if (!stages.contains(handler.stage())) return unknownStage(handler);
        }
        return null;
    }

    private static String unknownStage(TickHandler handler) {
        return "Clock handler '" + handler.handlerId() + "' names stage '" + handler.stage()
                + "', which clock.handler.order.v1 does not define.";
    }

    /** Handlers in the allowed stages, ordered by stage position then handler id. */
    List<TickHandler> order(List<String> allStages, List<String> allowedStages) {
        List<TickHandler> out = new ArrayList<>();
        for (TickHandler handler : byId.values()) {
            if (allowedStages.contains(handler.stage())) out.add(handler);
        }
        out.sort((a, b) -> {
            int byStage = Integer.compare(allStages.indexOf(a.stage()), allStages.indexOf(b.stage()));
            return byStage != 0 ? byStage : a.handlerId().compareTo(b.handlerId());
        });
        return out;
    }
}
