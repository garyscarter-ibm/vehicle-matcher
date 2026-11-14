package gcsp.api.offers;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.offers.OfferRecords.OfferRecord;
import gcsp.api.policy.PolicyClock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** The owner-safe projection of an offer: no hold id, no other employee, no internal error text. */
public record OfferView(
        String offerId,
        String state,
        String reason,
        Instant serverNow,
        Instant expiresAt,
        long offerVersion,
        long holdVersion,
        String offerState,
        String holdState,
        List<String> availableActions,
        Quote quote) {

    public record Quote(String quoteId, String orderUuid, String configurationId, String policyVersion,
            String briefVersion, Instant quotedAt, Instant validUntil, Integer monthlyPoints, String vehicleName,
            String imagePath, String gateStatus) {}

    public OfferView {
        availableActions = List.copyOf(availableActions);
    }

    /** Empty when the offer and hold states do not pair up; callers answer unavailable, never a guess. */
    public static Optional<OfferView> project(OfferRecord r, Instant now) {
        String[] pair = presentation(r.state(), r.holdState(), now, r.expiresAt());
        if (pair == null) {
            return Optional.empty();
        }
        boolean actionable = "awaiting-decision".equals(pair[1]) && "eligible".equals(r.gateStatus());
        List<String> actions = !actionable ? List.of()
                : r.validUntil() == null || now.isBefore(r.validUntil()) ? List.of("accept", "decline")
                        : List.of("decline");
        Quote quote = new Quote(r.quoteId(), r.orderUuid(), r.configurationId(), r.policyVersion(), r.briefVersion(),
                r.quotedAt(), r.validUntil(), r.monthlyPoints(), r.vehicleName(), r.imagePath(), r.gateStatus());
        return Optional.of(new OfferView(r.offerId(), pair[0], pair[1], now, r.expiresAt(), r.version(),
                r.holdVersion(), r.state(), r.holdState(), actions, quote));
    }

    private static String[] presentation(String offer, String hold, Instant now, Instant expiresAt) {
        if (offer == null || hold == null) return null;
        return switch (offer) {
            case "decision-pending" -> hold.equals("selection-pending") ? pair("pending", "decision-pending") : null;
            case "release-pending" -> hold.equals("release-pending") ? pair("pending", "release-pending") : null;
            case "accepted" -> hold.equals("allocated") ? pair("accepted", "accepted") : null;
            case "declined" -> hold.equals("released") ? pair("declined", "declined") : null;
            case "superseded" -> hold.equals("released") || hold.equals("expired")
                    ? pair("superseded", "superseded") : null;
            case "expired" -> hold.equals("expired") ? pair("expired", "deadline-passed")
                    : hold.equals("release-pending") ? pair("expired", "release-pending") : null;
            case "released" -> hold.equals("released") || hold.equals("expired") ? pair("released", "released") : null;
            case "active" -> !hold.equals("active") || expiresAt == null ? null
                    : !now.isBefore(expiresAt) ? pair("expired", "deadline-passed")
                            : pair("pending", "awaiting-decision");
            default -> null;
        };
    }

    private static String[] pair(String state, String reason) {
        return new String[] {state, reason};
    }

    public ObjectNode toJson() {
        JsonNodeFactory f = JsonNodeFactory.instance;
        ObjectNode n = f.objectNode();
        n.put("schemaVersion", 1);
        n.put("offerId", offerId);
        n.put("state", state);
        n.put("reason", reason);
        n.put("serverNow", PolicyClock.iso(serverNow));
        n.put("expiresAt", iso(expiresAt));
        n.put("offerVersion", offerVersion);
        n.put("holdVersion", holdVersion);
        n.put("offerState", offerState);
        n.put("holdState", holdState);
        var actions = n.putArray("availableActions");
        availableActions.forEach(actions::add);
        ObjectNode q = n.putObject("quote");
        q.put("quoteId", quote.quoteId());
        q.put("orderUuid", quote.orderUuid());
        q.put("configurationId", quote.configurationId());
        q.put("policyVersion", quote.policyVersion());
        q.put("briefVersion", quote.briefVersion());
        q.put("quotedAt", iso(quote.quotedAt()));
        q.put("validUntil", iso(quote.validUntil()));
        if (quote.monthlyPoints() == null) q.putNull("monthlyPoints"); else q.put("monthlyPoints", quote.monthlyPoints());
        q.put("vehicleName", quote.vehicleName());
        q.put("imagePath", quote.imagePath());
        q.put("gateStatus", quote.gateStatus());
        return n;
    }

    private static String iso(Instant i) {
        return i == null ? null : PolicyClock.iso(i);
    }
}
