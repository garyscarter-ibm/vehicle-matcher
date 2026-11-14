package gcsp.api.returns;

import gcsp.api.persistence.RunContext;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;

/** No handover source is wired yet: every read is unavailable. */
@ApplicationScoped
@DefaultBean
public class UnconfiguredHandover implements HandoverPort {

    public static final String CODE = "handover-unavailable";

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public HandoverReading read(RunContext ctx, String orderUuid) {
        return new HandoverReading.Unavailable(CODE, true, "Your handover could not be read.");
    }
}
