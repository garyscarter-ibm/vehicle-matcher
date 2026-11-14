package gcsp.api.clock.bound;

import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.documents.DocumentOutcome;
import gcsp.api.documents.DocumentService;
import gcsp.api.documents.DocumentsWiring;
import gcsp.api.persistence.Persistence;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Opens and advances document work on the pending-reconciliation stage; registered when persistence is on. */
@ApplicationScoped
public class DocumentsTickHandler implements TickHandler {

    public static final String ID = "lifecycle-documents";
    public static final String STAGE = "pending-reconciliation";

    @Inject
    DocumentsWiring documents;

    @Inject
    Persistence persistence;

    @Override
    public String handlerId() {
        return ID;
    }

    @Override
    public String stage() {
        return STAGE;
    }

    @Override
    public boolean enabled() {
        return persistence.active();
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        DocumentService service = documents.service();
        if (service == null) return new HandlerOutcome.Failed("unavailable", "documents-unavailable", true);
        return map(service.tick(request.scope(), request.tickId(), request.now(), request.policyVersion()));
    }

    static HandlerOutcome map(DocumentOutcome outcome) {
        if ("ok".equals(outcome.status())) return new HandlerOutcome.Ok(outcome.value());
        String code = outcome.code() == null ? "documents-failed" : outcome.code();
        return new HandlerOutcome.Failed(outcome.status(), code, outcome.retryable());
    }
}
