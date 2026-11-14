package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.TreeSet;

/** Structural JSON comparison that treats numbers by value (1 equals 1.0) and ignores key order. */
final class JsonCompare {

    private JsonCompare() {
    }

    /** First difference as a path and reason, or null when equal. */
    static String diff(JsonNode expected, JsonNode actual) {
        List<String> out = new ArrayList<>();
        walk("$", expected, actual, out);
        return out.isEmpty() ? null : out.get(0);
    }

    private static void walk(String path, JsonNode a, JsonNode b, List<String> out) {
        if (!out.isEmpty()) {
            return;
        }
        if (a == null || b == null) {
            if (a != b) {
                out.add(path + ": " + a + " vs " + b);
            }
        } else if (a.isNumber() && b.isNumber()) {
            if (a.decimalValue().compareTo(b.decimalValue()) != 0) {
                out.add(path + ": " + a + " vs " + b);
            }
        } else if (a.isObject() && b.isObject()) {
            TreeSet<String> names = new TreeSet<>();
            a.fieldNames().forEachRemaining(names::add);
            b.fieldNames().forEachRemaining(names::add);
            for (String name : names) {
                walk(path + "." + name, a.get(name), b.get(name), out);
            }
        } else if (a.isArray() && b.isArray()) {
            if (a.size() != b.size()) {
                out.add(path + ": array length " + a.size() + " vs " + b.size());
                return;
            }
            Iterator<JsonNode> x = a.elements();
            Iterator<JsonNode> y = b.elements();
            int i = 0;
            while (x.hasNext()) {
                walk(path + "[" + i++ + "]", x.next(), y.next(), out);
            }
        } else if (!a.equals(b)) {
            String left = a.toString();
            String right = b.toString();
            out.add(path + ": " + left.substring(0, Math.min(120, left.length())) + " vs "
                    + right.substring(0, Math.min(120, right.length())));
        }
    }
}
