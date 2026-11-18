package gcsp.api.scenario;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

import gcsp.api.clock.ActiveRunPrincipal;
import gcsp.api.identity.Principal;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A principal follows the active run when its own run exists; an unknown or blank run stays as it was. */
class ActiveRunPrincipalTest {

    private static Principal principal(String run) {
        return new Principal("sub", List.of("employee"), ScenarioFixture.ENV, run, "employee-paula", "p1", List.of());
    }

    @Test
    void followsTheActiveRunAfterAResetAndLeavesUnknownRunsAlone() throws Exception {
        try (ScenarioFixture fx = ScenarioFixture.create()) {
            ActiveRunPrincipal binder = new ActiveRunPrincipal();
            var pool = fx.pool();
            Principal active = principal("run-1");
            assertSame(active, binder.bind(active, pool));
            fx.rawReset().reset(ScenarioFixture.ENV, "presenter:test", "cmd-1", "run-1", "run-2");
            assertEquals("run-2", binder.bind(active, pool).runId());
            assertEquals("employee-paula", binder.bind(active, pool).employeeId());
            Principal unknown = principal("run-0");
            assertSame(unknown, binder.bind(unknown, pool));
            Principal blank = principal(" ");
            assertSame(blank, binder.bind(blank, pool));
        }
    }
}
