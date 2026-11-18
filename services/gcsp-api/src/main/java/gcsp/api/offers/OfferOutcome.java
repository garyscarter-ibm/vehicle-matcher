package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** The typed answer of an offer read; current is set only on the two 409 decision refusals. */
public record OfferOutcome(int http, String status, String code, String reason, boolean retryable, JsonNode value,
        JsonNode current, JsonNode savedChange) {

    public OfferOutcome(int http, String status, String code, String reason, boolean retryable, JsonNode value,
            JsonNode current) {
        this(http, status, code, reason, retryable, value, current, null);
    }

    /** A failure that still shows the brief change the employee has already saved. */
    public OfferOutcome withSavedChange(JsonNode saved) {
        return new OfferOutcome(http, status, code, reason, retryable, value, current, saved);
    }

    public static OfferOutcome ok(JsonNode value) {
        return new OfferOutcome(200, "ok", null, null, false, value, null);
    }

    /** The remote decision is recorded but not yet confirmed; the value is the stored pending receipt. */
    public static OfferOutcome pending(JsonNode value) {
        return pending(value, "release-pending");
    }

    public static OfferOutcome pending(JsonNode value, String code) {
        return new OfferOutcome(202, "pending", code, "Your decision is recorded and is being confirmed.", false, value,
                null);
    }

    public static OfferOutcome invalid(String code, String reason) {
        return new OfferOutcome(400, "invalid", code, reason, false, null, null);
    }

    public static OfferOutcome forbidden(String code, String reason) {
        return new OfferOutcome(403, "forbidden", code, reason, false, null, null);
    }

    public static OfferOutcome notFound() {
        return new OfferOutcome(404, "not-found", "offer-not-found", "No offer was found for this link.", false,
                null, null);
    }

    public static OfferOutcome staleRun() {
        return new OfferOutcome(409, "stale-run", "offer-from-earlier-run",
                "This offer is from an earlier demo run. Open your latest offer from your account.", false, null,
                null);
    }

    public static OfferOutcome unavailable() {
        return new OfferOutcome(503, "unavailable", "offer-access-unavailable",
                "Offers cannot be opened right now. Try again shortly.", true, null, null);
    }

    public static OfferOutcome inconsistent() {
        return new OfferOutcome(503, "unavailable", "offer-state-inconsistent",
                "This offer cannot be shown right now. Ask the scheme team to check it.", false, null, null);
    }

    public static OfferOutcome conflict(String code, String reason, OfferView view) {
        ObjectNode current = JsonNodeFactory.instance.objectNode();
        current.put("state", view.state());
        current.put("offerVersion", view.offerVersion());
        return new OfferOutcome(409, "conflict", code, reason, false, null, current);
    }

    public static OfferOutcome of(int http, String status, String code, String reason, boolean retryable) {
        return new OfferOutcome(http, status, code, reason, retryable, null, null);
    }

    /** A 409 carrying the state and version the caller should reload against. */
    public static OfferOutcome conflict(String code, String reason, String state, long offerVersion) {
        ObjectNode current = JsonNodeFactory.instance.objectNode();
        current.put("state", state);
        current.put("offerVersion", offerVersion);
        return new OfferOutcome(409, "conflict", code, reason, false, null, current);
    }
}
