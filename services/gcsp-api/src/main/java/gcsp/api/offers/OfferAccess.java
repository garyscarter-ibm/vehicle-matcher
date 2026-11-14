package gcsp.api.offers;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.identity.Principal;
import gcsp.api.offers.OfferRecords.OfferRecord;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.List;
import java.util.regex.Pattern;

/** The single home of offer ownership: the id is not a secret, so only the signed-in owner is authorised. */
@ApplicationScoped
public class OfferAccess {

    private static final Pattern REFERENCE = Pattern.compile("[A-Za-z0-9._:~-]{1,128}");

    @Inject
    OfferRecords records;

    @Inject
    PolicyClock clock;

    OfferAccess() {}

    OfferAccess(OfferRecords records, PolicyClock clock) {
        this.records = records;
        this.clock = clock;
    }

    public OfferOutcome read(Principal p, String offerId) {
        Resolved r = resolve(p, offerId);
        return r.refusal != null ? r.refusal : OfferOutcome.ok(r.view.toJson());
    }

    public OfferOutcome listCurrent(Principal p) {
        if (!Access.owns(p, p.employeeId())) return roleRequired();
        OfferRecords.Listing listing;
        try {
            listing = records.listForEmployee(context(p), p.employeeId());
        } catch (RuntimeException e) {
            return OfferOutcome.unavailable();
        }
        if (!(listing instanceof OfferRecords.Listed listed)) return OfferOutcome.unavailable();
        ObjectNode value = JsonNodeFactory.instance.objectNode();
        var offers = value.putArray("offers");
        List<OfferRecords.OfferSummary> rows = listed.offers();
        for (OfferRecords.OfferSummary s : rows.subList(0, Math.min(rows.size(), OfferRecords.LIST_LIMIT))) {
            ObjectNode o = offers.addObject();
            o.put("offerId", s.offerId());
            o.put("state", s.state());
            o.put("createdAt", s.createdAt() == null ? null : PolicyClock.iso(s.createdAt()));
        }
        return OfferOutcome.ok(value);
    }

    /** For accept and decline: refuses unless the owner's read succeeds, the version matches and an action exists. */
    public OfferAuthority authorizeDecision(Principal p, String offerId, long expectedOfferVersion) {
        Resolved r = resolve(p, offerId);
        if (r.refusal != null) return new OfferAuthority.Refused(r.refusal);
        if (r.view.offerVersion() != expectedOfferVersion) {
            return new OfferAuthority.Refused(OfferOutcome.conflict("stale-version",
                    "This offer has changed. Reload it and try again.", r.view));
        }
        if (r.view.availableActions().isEmpty()) {
            return new OfferAuthority.Refused(OfferOutcome.conflict("offer-not-actionable",
                    "This offer can no longer be decided.", r.view));
        }
        return new OfferAuthority.Authorized(r.record, r.view);
    }

    private Resolved resolve(Principal p, String offerId) {
        if (!Access.owns(p, p.employeeId())) return Resolved.refused(roleRequired());
        if (offerId == null || !REFERENCE.matcher(offerId).matches()) {
            return Resolved.refused(OfferOutcome.invalid("invalid-offer-reference",
                    "This offer link is not valid. Open the link from your email again."));
        }
        OfferRecords.Lookup found;
        Instant now;
        try {
            RunContext ctx = context(p);
            found = records.find(ctx, offerId);
            now = clock.now(ctx);
        } catch (RuntimeException e) {
            return Resolved.refused(OfferOutcome.unavailable());
        }
        if (found instanceof OfferRecords.Missing) return Resolved.refused(OfferOutcome.notFound());
        if (found instanceof OfferRecords.StaleRun) return Resolved.refused(OfferOutcome.staleRun());
        if (!(found instanceof OfferRecords.Found f) || f.record() == null || now == null) {
            return Resolved.refused(OfferOutcome.unavailable());
        }
        OfferRecord record = f.record();
        if (!Access.owns(p, record.employeeId())) {
            return Resolved.refused(OfferOutcome.forbidden("offer-not-owned",
                    "Sign in as the employee this offer was sent to."));
        }
        return OfferView.project(record, now).map(v -> new Resolved(null, record, v))
                .orElseGet(() -> Resolved.refused(OfferOutcome.inconsistent()));
    }

    private static OfferOutcome roleRequired() {
        return OfferOutcome.forbidden("role-required", "Sign in as an employee to see offers.");
    }

    private static RunContext context(Principal p) {
        return new RunContext(p.environmentId(), p.runId(), p.subject());
    }

    private record Resolved(OfferOutcome refusal, OfferRecord record, OfferView view) {
        static Resolved refused(OfferOutcome o) {
            return new Resolved(o, null, null);
        }
    }
}
