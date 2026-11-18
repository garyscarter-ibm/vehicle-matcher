package gcsp.api.demand;

import gcsp.api.clock.ClockReading;
import java.util.Optional;

/** The run clock the projections read (Node clock.now(context)); empty when the run has no readable clock. */
interface DemandClock {

    Optional<ClockReading> now(DemandScope scope);
}
