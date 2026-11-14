package gcsp.api.demand;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.demand.Disclosure.Cell;
import gcsp.api.demand.Disclosure.Kind;
import gcsp.api.demand.Disclosure.Relation;
import java.util.List;
import org.junit.jupiter.api.Test;

class DisclosureTest {

    private static Cell group(String key, long v, int n) {
        return new Cell(key, v, 1, n);
    }

    private static Cell fixed(String key, long v, int n) {
        return new Cell(key, v, 0, n);
    }

    @Test
    void thresholdEdges() {
        assertEquals(Kind.FEWER_THAN, fixed("a", 4, 5).kind);
        assertEquals(Kind.EXACT, fixed("a", 5, 5).kind);
        assertEquals(Kind.FEWER_THAN, fixed("a", 0, 5).kind);
        ObjectNode band = Disclosure.render(fixed("a", 4, 5), 5);
        assertEquals("{\"kind\":\"band\",\"fewerThan\":5,\"label\":\"fewer than 5\"}", band.toString());
        assertEquals("{\"kind\":\"exact\",\"value\":5,\"label\":\"5\"}", Disclosure.render(fixed("a", 5, 5), 5).toString());
        assertEquals("{\"kind\":\"band\",\"fewerThan\":5,\"label\":\"fewer than 5\"}", Disclosure.render(fixed("a", 0, 5), 5).toString());
        Cell a = fixed("a", 9, 5);
        a.kind = Kind.AT_LEAST;
        assertEquals("{\"kind\":\"band\",\"atLeast\":5,\"label\":\"5 or more\"}", Disclosure.render(a, 5).toString());
    }

    @Test
    void singleSmallCellInAPartitionForcesASecondary() {
        Cell parent = fixed("total", 12, 5);
        Cell small = group("small", 2, 5);
        Cell big = group("big", 10, 5);
        Disclosure.apply(5, List.of(Relation.partition(parent, List.of(small, big))));
        assertEquals(Kind.EXACT, parent.kind);
        assertEquals(Kind.FEWER_THAN, small.kind);
        assertEquals(Kind.AT_LEAST, big.kind);
    }

    @Test
    void residualCaseWithNFiveIsWithheld() {
        // parent 8 = 4 + 4: either small cell is the difference of the parent and the other.
        Cell parent = fixed("total", 8, 5);
        Cell x = group("x", 4, 5);
        Cell y = group("y", 4, 5);
        Disclosure.apply(5, List.of(Relation.partition(parent, List.of(x, y))));
        assertEquals(Kind.AT_LEAST, parent.kind);
        assertEquals(Kind.FEWER_THAN, x.kind);
    }

    @Test
    void secondaryNeedsEnoughRoomOrTheParentFallsBack() {
        // 5 + 3 = 8: moving 5 to "5 or more" leaves R = 8, needing 5 + 0 + 4 = 9, so the parent is withheld too.
        Cell parent = fixed("total", 8, 5);
        Cell big = group("big", 5, 5);
        Cell small = group("small", 3, 5);
        Disclosure.apply(5, List.of(Relation.partition(parent, List.of(big, small))));
        assertEquals(Kind.AT_LEAST, big.kind);
        assertEquals(Kind.AT_LEAST, parent.kind);
        // 9 = 5 + 4 has room: the secondary alone is safe.
        Cell p2 = fixed("total", 9, 5);
        Cell b2 = group("big", 5, 5);
        Cell s2 = group("small", 4, 5);
        Disclosure.apply(5, List.of(Relation.partition(p2, List.of(b2, s2))));
        assertEquals(Kind.EXACT, p2.kind);
        assertEquals(Kind.AT_LEAST, b2.kind);
    }

    @Test
    void secondaryWithheldCellKeepsTheSmallCellAmbiguous() {
        // Brute force: with the published cells, more than one value of the small cell fits the parent.
        int n = 5;
        for (int parentValue = 5; parentValue <= 30; parentValue++) {
            for (int small = 1; small < n; small++) {
                for (int big = n; big + small <= parentValue; big++) {
                    if (big + small != parentValue) continue;
                    Cell parent = fixed("total", parentValue, n);
                    Cell s = group("s", small, n);
                    Cell b = group("b", big, n);
                    Disclosure.apply(n, List.of(Relation.partition(parent, List.of(s, b))));
                    if (parent.kind != Kind.EXACT || s.kind != Kind.FEWER_THAN) continue;
                    int feasible = 0;
                    for (int v = 1; v < n; v++) if (parentValue - v >= n) feasible++;
                    assertTrue(feasible >= 2, "parent " + parentValue + " small " + small + " is solvable");
                }
            }
        }
    }

    @Test
    void coverNeedsOneAtLeastCell() {
        Cell parent = fixed("total", 20, 5);
        Cell small = group("small", 3, 5);
        Cell big = group("big", 15, 5);
        Cell other = group("other", 8, 5);
        Disclosure.apply(5, List.of(Relation.cover(parent, List.of(small, big, other))));
        assertEquals(Kind.EXACT, parent.kind);
        assertEquals(Kind.FEWER_THAN, small.kind);
        assertEquals(Kind.AT_LEAST, other.kind);
        assertEquals(Kind.EXACT, big.kind);
    }

    @Test
    void coverWithNoExactChildWithholdsTheParent() {
        Cell parent = fixed("total", 20, 5);
        Cell a = group("a", 3, 5);
        Cell b = group("b", 4, 5);
        Disclosure.apply(5, List.of(Relation.cover(parent, List.of(a, b))));
        assertEquals(Kind.AT_LEAST, parent.kind);
    }

    @Test
    void bandedParentNeedsNothingAndExactChildrenNeedNothing() {
        Cell parent = fixed("total", 3, 5);
        Cell child = group("c", 3, 5);
        Disclosure.apply(5, List.of(Relation.partition(parent, List.of(child))));
        assertEquals(Kind.FEWER_THAN, parent.kind);
        assertEquals(Kind.FEWER_THAN, child.kind);
        Cell p2 = fixed("total", 20, 5);
        Cell c2 = group("c", 10, 5);
        Cell c3 = group("d", 10, 5);
        Disclosure.apply(5, List.of(Relation.partition(p2, List.of(c2, c3))));
        assertEquals(Kind.EXACT, c2.kind);
        assertEquals(Kind.EXACT, c3.kind);
    }

    @Test
    void thresholdOneNeverWithholds() {
        Cell parent = fixed("total", 3, 1);
        Cell zero = fixed("zero", 0, 1);
        Cell x = group("x", 3, 1);
        Disclosure.apply(1, List.of(Relation.partition(parent, List.of(zero, x))));
        assertEquals(Kind.FEWER_THAN, zero.kind);
        assertEquals(Kind.EXACT, x.kind);
        assertEquals(Kind.EXACT, parent.kind);
    }

    @Test
    void withholdingFlowsAcrossRelationsToAFixpoint() {
        // holds: total 30, byState {active 6 (n=5 exact), released 3 (band)}, active 6 = {active cell 6}.
        int n = 5;
        Cell total = fixed("total", 30, n);
        Cell active = fixed("active", 6, n);
        Cell stActive = group("active", 6, n);
        Cell stReleased = group("released", 3, n);
        Cell stExpired = group("expired", 21, n);
        List<Relation> relations = List.of(Relation.partition(total, List.of(stActive, stReleased, stExpired)),
                Relation.partition(active, List.of(stActive)));
        Disclosure.apply(n, relations);
        assertEquals(Kind.FEWER_THAN, stReleased.kind);
        // The total relation withholds 6; active = {6} would then reveal it, so active is withheld as well.
        assertEquals(Kind.AT_LEAST, stActive.kind);
        assertEquals(Kind.AT_LEAST, active.kind);
        assertEquals(Kind.EXACT, total.kind);
    }
}
