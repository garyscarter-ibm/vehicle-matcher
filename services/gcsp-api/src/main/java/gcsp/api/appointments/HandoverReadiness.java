package gcsp.api.appointments;

import java.util.List;

/** What the documents service says about handover readiness (slice B completion gate). */
public sealed interface HandoverReadiness {

    record Ok(boolean ready, String state, boolean documentsComplete, boolean vehicleReady, List<String> blocking,
            String documentsRevision) implements HandoverReadiness {
        public Ok {
            blocking = List.copyOf(blocking);
        }
    }

    record Unavailable() implements HandoverReadiness {}
}
