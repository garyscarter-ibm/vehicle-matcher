package gcsp.api.returns;

import gcsp.api.persistence.RunContext;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;

/** No selection record is wired yet: every read is unavailable (retryable), so nothing is planned from a guess. */
@ApplicationScoped
@DefaultBean
public class UnconfiguredReturnSource implements ReturnSourcePort {

    public static final String CODE = "return-source-unavailable";

    @Override
    public ReturnSourceReading read(RunContext ctx, String orderUuid) {
        return new ReturnSourceReading.Unavailable(CODE, true, "The record of your current car is not available yet.");
    }
}
