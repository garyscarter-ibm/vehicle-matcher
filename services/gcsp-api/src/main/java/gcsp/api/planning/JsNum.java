package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.DoubleNode;
import com.fasterxml.jackson.databind.node.LongNode;
import java.math.BigDecimal;

/** JavaScript number semantics the Node planner relies on: safe integers and number to string. */
final class JsNum {

    static final double MAX_SAFE = 9007199254740991.0;

    private JsNum() {
    }

    /** Number.isSafeInteger. */
    static boolean safe(double d) {
        return !Double.isNaN(d) && !Double.isInfinite(d) && d == Math.rint(d) && Math.abs(d) <= MAX_SAFE;
    }

    /** The planner's integer(): a safe integer that is not negative. */
    static boolean integer(JsonNode n) {
        return n != null && n.isNumber() && safe(n.doubleValue()) && n.doubleValue() >= 0;
    }

    /** A JSON number for a double the planner produced: a long when safe, else the double itself. */
    static JsonNode node(double d) {
        return safe(d) ? LongNode.valueOf((long) d) : DoubleNode.valueOf(d);
    }

    /** Number.prototype.toString for a finite double (ECMAScript Number::toString). */
    static String str(double d) {
        if (d == 0) {
            return "0";
        }
        if (d < 0) {
            return "-" + str(-d);
        }
        BigDecimal bd = new BigDecimal(Double.toString(d)).stripTrailingZeros();
        String digits = bd.unscaledValue().toString();
        int k = digits.length();
        int n = k - bd.scale();
        if (k <= n && n <= 21) {
            return digits + "0".repeat(n - k);
        }
        if (0 < n && n <= 21) {
            return digits.substring(0, n) + "." + digits.substring(n);
        }
        if (-6 < n && n <= 0) {
            return "0." + "0".repeat(-n) + digits;
        }
        int e = n - 1;
        String exp = (e < 0 ? "-" : "+") + Math.abs(e);
        return k == 1 ? digits + "e" + exp : digits.charAt(0) + "." + digits.substring(1) + "e" + exp;
    }
}
