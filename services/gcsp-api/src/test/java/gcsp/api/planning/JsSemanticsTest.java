package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The JavaScript number and instant rules the planner mirrors, checked against known Node outputs. */
class JsSemanticsTest {

    @Test
    void numbersPrintLikeJavaScript() {
        assertEquals("18", JsNum.str(18));
        assertEquals("1e+21", JsNum.str(1e21));
        assertEquals("9007199254740992", JsNum.str(9007199254740992.0));
        assertEquals("1.5e+300", JsNum.str(1.5e300));
        assertTrue(JsNum.safe(9007199254740991.0));
        assertTrue(!JsNum.safe(9007199254740992.0));
    }

    @Test
    void instantsFollowValidInstantAndToISOString() {
        assertEquals(1793923200000L, JsTime.parse("2026-11-06T00:00:00.000Z"));
        assertEquals(1793923200500L, JsTime.parse("2026-11-06T00:00:00.5Z"));
        assertNull(JsTime.parse("2026-11-31T00:00:00Z"));
        assertNull(JsTime.parse("2026-11-06T24:00:00Z"));
        assertEquals("2026-11-16T00:00:00.001Z", JsTime.iso(1793923200000L + 10 * JsTime.DAY + 1));
        assertEquals(1796083200000.0, JsTime.lenient("2026-11-31T00:00:00Z"));
        assertTrue(Double.isNaN(JsTime.lenient("2026-11-06T25:00:00Z")));
    }
}
