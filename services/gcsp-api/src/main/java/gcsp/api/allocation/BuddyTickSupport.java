package gcsp.api.allocation;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.TickRequest;

/** Shared by the Buddy tick handlers: the allocation scope of a tick and the candidates-provider switch. */
final class BuddyTickSupport {

    static final String CANDIDATES_KEY = "gcsp.allocation.candidates.provider";

    private BuddyTickSupport() {}

    static AllocationScope scope(TickRequest r) {
        return new AllocationScope(r.scope().environmentId(), r.scope().runId(), r.policyVersion(), r.now(), r.clockVersion());
    }

    /** With candidates none, allocation refuses every trigger and no Buddy hold exists, so the stages stay unregistered. */
    static boolean candidatesConfigured(String provider) {
        return provider != null && !provider.isBlank() && !"none".equals(provider.trim());
    }

    static ObjectNode counts() {
        return JsonNodeFactory.instance.objectNode();
    }
}
