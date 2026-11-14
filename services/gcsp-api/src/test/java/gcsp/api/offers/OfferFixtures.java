package gcsp.api.offers;

import gcsp.api.identity.Principal;
import gcsp.api.offers.OfferRecords.OfferRecord;
import java.time.Instant;
import java.util.List;

/** Shared builders for the offer tests. */
final class OfferFixtures {

    static final Instant NOW = Instant.parse("2026-11-14T09:00:00Z");
    static final String HEX = "a".repeat(64);
    static final String OFFER = "buddy-offer:" + HEX;

    private OfferFixtures() {}

    static OfferRecord record(String offerId, String employeeId, String offerState, String holdState) {
        return new OfferRecord(offerId, employeeId, "buddy-hold:" + HEX, holdState, "buddy-quote:" + HEX, "order-1",
                "config-1", offerState, NOW.plusSeconds(3600), 7, 3, NOW.minusSeconds(600), "policy-1", "brief-1",
                NOW.minusSeconds(300), NOW.plusSeconds(1800), 420, "BMW 120d", "/img/a.jpg", "eligible");
    }

    static OfferRecord active(String employeeId) {
        return record(OFFER, employeeId, "active", "active");
    }

    static Principal employee(String employeeId) {
        return new Principal("sub-" + employeeId, List.of("employee"), "env-1", "run-1", employeeId, "policy-1",
                List.of("account:read"));
    }

    static Principal role(String role) {
        return new Principal("sub-" + role, List.of(role), "env-1", "run-1", null, "policy-1", List.of());
    }
}
