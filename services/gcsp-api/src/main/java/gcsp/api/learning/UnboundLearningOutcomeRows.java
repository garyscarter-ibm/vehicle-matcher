package gcsp.api.learning;

import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import java.sql.Connection;

/** Empty fallback for isolated/unbound compositions; the production PostgreSQL adapter replaces this default bean. */
@DefaultBean
@ApplicationScoped
public class UnboundLearningOutcomeRows implements LearningOutcomeRows {

    @Override
    public boolean bound() {
        return false;
    }

    @Override
    public Rows read(Connection snapshot, String environmentId, String runId) {
        return Rows.EMPTY;
    }
}
