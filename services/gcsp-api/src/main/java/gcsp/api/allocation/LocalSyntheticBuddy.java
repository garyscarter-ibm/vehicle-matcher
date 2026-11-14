package gcsp.api.allocation;

import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;

/** The default: Buddy stays local and synthetic, so no remote call is ever made. */
@DefaultBean
@ApplicationScoped
public class LocalSyntheticBuddy implements RemoteBuddy {

    @Override
    public String mode() {
        return "local-synthetic";
    }

    @Override
    public Ack execute(RemoteOperation op) {
        throw new IllegalStateException("No remote Buddy is configured");
    }

    @Override
    public Ack reconcile(RemoteOperation op) {
        throw new IllegalStateException("No remote Buddy is configured");
    }
}
