package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.account.AccountOutcome;
import gcsp.api.account.AccountScope;
import gcsp.api.account.AccountService;
import gcsp.api.identity.Principal;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.List;

/** The employee's entitlement slots, read from their own account projection; the request never names one. */
@ApplicationScoped
public class OrderingSlots {

    /** orderable is the slot with ordering.enabled (null when none); all is every slot id; code is set on failure. */
    public record Slots(String orderable, List<String> all, int http, String code) {}

    @Inject
    AccountService account;

    public Slots resolve(Principal p) {
        try {
            return parse(read(p));
        } catch (RuntimeException e) {
            return new Slots(null, List.of(), 503, "account-unavailable");
        }
    }

    /** The account projection for the caller alone: the trusted slot comes from the HR record, not the request. */
    protected AccountOutcome read(Principal p) {
        return account.readAccount(new AccountScope(p.environmentId(), p.runId(), p.employeeId(), null,
                List.of("employee"), null, null, null, null, p.policyVersion()));
    }

    static Slots parse(AccountOutcome out) {
        if (out == null || !out.isOk()) return new Slots(null, List.of(), 503, "account-unavailable");
        String orderable = null;
        List<String> all = new ArrayList<>();
        for (JsonNode s : out.value().path("slots")) {
            if (!s.path("entitlementSlotId").isTextual()) continue;
            String id = s.get("entitlementSlotId").asText();
            all.add(id);
            if (orderable == null && s.path("ordering").path("enabled").asBoolean(false)) orderable = id;
        }
        return new Slots(orderable, all, 200, null);
    }
}
