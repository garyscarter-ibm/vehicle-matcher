package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;

/** One validated, privately owned policy version with its row tables and read-side caches. */
final class PolicyVersion {

    /** A table row with its effective interval as epoch millis; `to` is Long.MAX_VALUE when open. */
    record Row(ObjectNode node, long from, long to) {

        boolean activeAt(long instant) {
            return from <= instant && instant < to;
        }

        String text(String field) {
            JsonNode value = node.get(field);
            return value != null && value.isTextual() ? value.textValue() : null;
        }
    }

    /** Eligibility lookup cell: the rules and links for one scheme, grade and model fact. */
    static final class Cell {
        final List<Row> rules = new ArrayList<>();
        final List<Row> links = new ArrayList<>();
        boolean excluded;
        boolean included;
    }

    static final class Scheme {
        final Map<String, Map<String, Cell>> grades = new HashMap<>();
        boolean unsupported;
    }

    record Compiled(Row field, Row precedence, Row mapping, Map<String, Scheme> schemes) {
    }

    final String policyVersion;
    final long from;
    final long to;
    final ObjectNode seed;
    private final Map<String, List<Row>> tables;
    private final Map<String, List<Row>> pinnedRows = new ConcurrentHashMap<>();
    private final long[] boundaries;
    private final Map<Integer, Compiled> compiled = new ConcurrentHashMap<>();

    PolicyVersion(String policyVersion, long from, long to, ObjectNode seed, Map<String, List<Row>> tables) {
        this.policyVersion = policyVersion;
        this.from = from;
        this.to = to;
        this.seed = seed;
        this.tables = tables;
        TreeSet<Long> all = new TreeSet<>();
        for (String table : List.of("assumptions", "schemeRuleLinks", "eligibilityRules")) {
            for (Row row : tables.get(table)) {
                all.add(row.from());
                if (row.to() != Long.MAX_VALUE) {
                    all.add(row.to());
                }
            }
        }
        this.boundaries = all.stream().mapToLong(Long::longValue).toArray();
    }

    boolean activeAt(long instant) {
        return from <= instant && instant < to;
    }

    /** Rows effective at the instant. A pinned read passes cache=true: its instant never changes. */
    List<Row> rows(String table, long at, boolean cache) {
        if (cache) {
            return pinnedRows.computeIfAbsent(table, t -> filter(t, at));
        }
        return filter(table, at);
    }

    private List<Row> filter(String table, long at) {
        List<Row> out = new ArrayList<>();
        for (Row row : tables.get(table)) {
            if (row.activeAt(at)) {
                out.add(row);
            }
        }
        return out;
    }

    /** The eligibility index for the interval between row boundaries that contains `at`. */
    Compiled eligibility(long at, boolean cache) {
        int low = 0;
        int high = boundaries.length;
        while (low < high) {
            int mid = (low + high) >>> 1;
            if (boundaries[mid] <= at) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        // Rows are filtered at the interval's own instant, so every `at` inside it compiles identically.
        return compiled.computeIfAbsent(low, k -> compile(rows("assumptions", at, false),
                rows("schemeRuleLinks", at, false), rows("eligibilityRules", at, false)));
    }

    private static Compiled compile(List<Row> assumptionRows, List<Row> links, List<Row> rules) {
        Map<String, Row> assumptions = new HashMap<>();
        for (Row row : assumptionRows) {
            assumptions.put(row.text("key"), row);
        }
        Row field = assumptions.get("eligibility.rule.matchField");
        Row precedence = assumptions.get("eligibility.rule.precedence");
        Row mapping = assumptions.get("eligibility.context.mapping");
        JsonNode fieldValue = field == null ? null : field.node().get("value");
        Map<String, Scheme> schemes = new HashMap<>();
        Map<String, List<Row>> linksByRule = new HashMap<>();
        for (Row link : links) {
            schemes.computeIfAbsent(link.text("schemeId"), k -> new Scheme());
            linksByRule.computeIfAbsent(link.text("ruleId"), k -> new ArrayList<>()).add(link);
        }
        Map<Row, List<Cell>> cellsByLink = new java.util.IdentityHashMap<>();
        // Rule order and link order are independent provenance contracts.
        for (Row rule : rules) {
            for (Row link : linksByRule.getOrDefault(rule.text("ruleId"), List.of())) {
                Scheme scheme = schemes.get(link.text("schemeId"));
                List<Cell> cells = new ArrayList<>();
                cellsByLink.put(link, cells);
                String matchField = rule.text("matchField");
                if (fieldValue == null || !fieldValue.isTextual() || !fieldValue.textValue().equals(matchField)
                        || !"equals".equals(rule.text("operator"))) {
                    scheme.unsupported = true;
                }
                for (JsonNode grade : rule.node().get("gradeIds")) {
                    Cell cell = scheme.grades.computeIfAbsent(grade.textValue(), k -> new HashMap<>())
                            .computeIfAbsent(rule.text("value"), k -> new Cell());
                    cell.rules.add(rule);
                    cell.excluded |= "exclude".equals(rule.text("effect"));
                    cell.included |= "include".equals(rule.text("effect"));
                    cells.add(cell);
                }
            }
        }
        for (Row link : links) {
            for (Cell cell : cellsByLink.getOrDefault(link, List.of())) {
                cell.links.add(link);
            }
        }
        return new Compiled(field, precedence, mapping, schemes);
    }
}
