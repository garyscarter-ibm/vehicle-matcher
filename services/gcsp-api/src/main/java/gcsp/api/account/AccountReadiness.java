package gcsp.api.account;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Readiness;

/** Ready once the account port is selected; mode "none" is ready and refuses every account read. */
@Readiness
@ApplicationScoped
public class AccountReadiness implements HealthCheck {

    @Inject
    AccountSelection selection;

    @Inject
    AccountRecordsPort records;

    @Override
    public HealthCheckResponse call() {
        return HealthCheckResponse.named("account-port").up().withData("provider", selection.mode()).build();
    }
}
