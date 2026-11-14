package gcsp.api.learning;

import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import java.sql.Connection;

/** Default binding: no outcome producer is merged, so every outcome stays unknown. Any other LearningOutcomeRows bean replaces it. */
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
