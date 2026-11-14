package gcsp.api.clock.bound;

import gcsp.api.appointments.AppointmentResult;
import gcsp.api.appointments.AppointmentService;
import gcsp.api.appointments.AppointmentsWiring;
import gcsp.api.auth.Role;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.identity.Principal;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;

/** Records the tick as appointment time, then progresses appointments; registered when a provider is configured. */
@ApplicationScoped
public class AppointmentsTickHandler implements TickHandler {

    public static final String ID = "lifecycle-appointments";
    public static final String STAGE = "pending-reconciliation";
    static final String SUBJECT = "system:clock";

    @Inject
    AppointmentsWiring wiring;

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
        return wiring.available() && !AppointmentsWiring.NONE.equals(wiring.mode());
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        if (request.startup()) return StartupSkip.OUTCOME;
        AppointmentService service = wiring.service();
        if (service == null) return new HandlerOutcome.Failed("unavailable", "appointments-unavailable", true);
        Principal who = system(request);
        AppointmentResult recorded = service.recordTick(who, request.scope(), request.tickId(), request.now());
        if (!(recorded instanceof AppointmentResult.Ok)) return map(recorded);
        return map(service.tick(who, request.scope(), request.now()));
    }

    /** A server-built presenter principal: the sibling service needs the role, and no caller supplies it. */
    static Principal system(TickRequest request) {
        return new Principal(SUBJECT, List.of(Role.PRESENTER.wire()), request.scope().environmentId(),
                request.scope().runId(), null, request.policyVersion(), Role.PRESENTER.capabilities());
    }

    static HandlerOutcome map(AppointmentResult result) {
        return switch (result) {
            case AppointmentResult.Ok ok -> new HandlerOutcome.Ok(ok.value());
            case AppointmentResult.Pending p -> new HandlerOutcome.Pending(p.operationId(), "appointment", "uncertain");
            case AppointmentResult.Conflict c when "stale-run".equals(c.code()) ->
                    new HandlerOutcome.Failed("stale-run", "stale-run", false);
            case AppointmentResult.Conflict c -> new HandlerOutcome.Failed("conflict", c.code(), false);
            case AppointmentResult.Unavailable u -> new HandlerOutcome.Failed("unavailable", u.code(), u.retryable());
            case AppointmentResult.Invalid i -> new HandlerOutcome.Failed("invalid", i.code(), false);
            case AppointmentResult.Forbidden f -> new HandlerOutcome.Failed("forbidden", f.code(), false);
            case AppointmentResult.NotFound n -> new HandlerOutcome.Failed("not-found", "appointment-not-found", false);
            case AppointmentResult.Unsupported u -> new HandlerOutcome.Failed("unsupported", u.code(), false);
        };
    }
}
