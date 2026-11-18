package gcsp.api.brief;

import com.fasterxml.jackson.databind.node.ObjectNode;

/** Evaluates an unsaved brief for the employee; returns the recommendation outcome JSON ({status, ...}). */
@FunctionalInterface
public interface BriefPreviewPort {

    /** input is {brief, baseBriefVersion, baseDraftVersion}; any non-ok status is passed on to the caller. */
    ObjectNode preview(BriefScope scope, ObjectNode input);

    /** The outcome when no recommendation source is wired. */
    static ObjectNode unconfigured() {
        ObjectNode o = Json.obj();
        o.put("status", "unavailable").put("code", "provider-not-configured");
        o.put("reason", "The employee recommendation source is unavailable.").put("retryable", true);
        return o;
    }
}
