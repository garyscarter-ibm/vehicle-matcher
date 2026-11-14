package gcsp.api.allocation;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.Comparator;

/** One ranked eligible (employee, exact car) pair with the versions it was planned against and its pinned quote. */
record Contender(String employeeId, String slotId, String renewalId, String orderUuid, Instant renewalDue, Double score,
        String lottery, ObjectNode expectedVersions, ArrayNode reasons, ObjectNode quote) {

    static Comparator<Contender> ranking(String rule) {
        Comparator<Contender> renewal = Comparator.comparing(Contender::renewalDue);
        Comparator<Contender> fit = (a, b) -> Double.compare(b.score() == null ? -1 : b.score(),
                a.score() == null ? -1 : a.score());
        Comparator<Contender> seeded = Comparator.comparing(Contender::lottery)
                .thenComparing(Contender::employeeId).thenComparing(Contender::orderUuid);
        return Assumptions.RULE_RENEWAL_FIRST.equals(rule)
                ? renewal.thenComparing(fit).thenComparing(seeded)
                : fit.thenComparing(renewal).thenComparing(seeded);
    }
}
