package gcsp.api.demand;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Comparator;
import java.util.List;

/**
 * Small-count privacy: a count below N is a band, and cells that would let a reader solve a band from the parent and
 * sibling cells in the same response are withheld too ("N or more"). Over-withholding is acceptable, under-withholding not.
 */
final class Disclosure {

    enum Kind { EXACT, FEWER_THAN, AT_LEAST }

    /** One published count. minimum is the least value it can have: 1 for a listed group, 0 for a fixed cell. */
    static final class Cell {
        final String key;
        final long value;
        final int minimum;
        Kind kind;

        Cell(String key, long value, int minimum, int n) {
            this.key = key;
            this.value = value;
            this.minimum = minimum;
            this.kind = value < n ? Kind.FEWER_THAN : Kind.EXACT;
        }

        boolean banded() {
            return kind != Kind.EXACT;
        }
    }

    /** A partition's children sum to the parent; a cover's children may sum to more. */
    record Relation(Cell parent, List<Cell> children, boolean partition) {
        static Relation partition(Cell parent, List<Cell> children) {
            return new Relation(parent, children, true);
        }

        static Relation cover(Cell parent, List<Cell> children) {
            return new Relation(parent, children, false);
        }
    }

    private Disclosure() {}

    /** Applies complementary withholding until no relation is unsafe; every move is monotonic, so it ends. */
    static void apply(int n, List<Relation> relations) {
        boolean changed = true;
        while (changed) {
            changed = false;
            for (Relation r : relations) changed |= settle(n, r);
        }
    }

    private static boolean settle(int n, Relation r) {
        boolean moved = false;
        while (r.parent().kind == Kind.EXACT && !safe(n, r)) {
            r.children().stream().filter(c -> c.kind == Kind.EXACT)
                    .min(Comparator.<Cell>comparingLong(c -> c.value).thenComparing(c -> c.key))
                    .ifPresentOrElse(c -> c.kind = Kind.AT_LEAST, () -> r.parent().kind = Kind.AT_LEAST);
            moved = true;
        }
        return moved;
    }

    /** A band cell whose range holds one value (for example fewer than 1) is already known to the reader. */
    private static boolean known(int n, Cell c) {
        return c.kind == Kind.EXACT || c.kind == Kind.FEWER_THAN && c.minimum >= n - 1;
    }

    private static boolean safe(int n, Relation r) {
        long hidden = r.children().stream().filter(c -> c.kind == Kind.FEWER_THAN && !known(n, c)).count();
        long atLeast = r.children().stream().filter(c -> c.kind == Kind.AT_LEAST).count();
        // A lone withheld part of an exact partition is the parent less the known parts, so it needs company.
        if (hidden == 0) return !(r.partition() && atLeast == 1);
        if (atLeast == 0) return false;
        if (!r.partition()) return true;
        long remainder = r.parent().value - r.children().stream().filter(c -> known(n, c))
                .mapToLong(c -> c.kind == Kind.EXACT ? c.value : c.minimum).sum();
        return remainder >= atLeast * n + (hidden - 1) + (n - 1);
    }

    /** The count object: exact, or a band that never carries a raw value. */
    static ObjectNode render(Cell c, int n) {
        ObjectNode o = Demand.obj();
        switch (c.kind) {
            case EXACT -> o.put("kind", "exact").put("value", c.value).put("label", String.valueOf(c.value));
            case FEWER_THAN -> o.put("kind", "band").put("fewerThan", n).put("label", "fewer than " + n);
            case AT_LEAST -> o.put("kind", "band").put("atLeast", n).put("label", n + " or more");
        }
        return o;
    }
}
