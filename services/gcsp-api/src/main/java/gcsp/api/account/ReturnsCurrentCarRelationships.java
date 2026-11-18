package gcsp.api.account;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import gcsp.api.persistence.RunContext;
import gcsp.api.returns.CurrentCarStore;
import gcsp.api.returns.CurrentCarView;
import java.sql.SQLException;

/** Lists the employee's recorded current-car relationships from the returns store (Node listCurrentCars). */
public final class ReturnsCurrentCarRelationships implements CurrentCarPort {

    private final CurrentCarStore store;

    public ReturnsCurrentCarRelationships(CurrentCarStore store) {
        this.store = store;
    }

    @Override
    public SourceResult list(AccountScope scope) {
        try {
            ArrayNode out = JsonNodeFactory.instance.arrayNode();
            RunContext ctx = new RunContext(scope.environmentId(), scope.runId(), scope.employeeId());
            for (CurrentCarView view : store.listForEmployee(ctx, scope.employeeId())) out.add(view.toJson());
            return SourceResult.ok(out);
        } catch (SQLException | RuntimeException e) {
            return SourceResult.unavailable("current-car-unavailable");
        }
    }
}
