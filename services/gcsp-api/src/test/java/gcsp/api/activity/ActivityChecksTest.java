package gcsp.api.activity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** The pure projections: source status from the latest tick, and the top two unmet essentials. */
class ActivityChecksTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ORDER = "[{\"handlerId\":\"stock\",\"stage\":\"release-pull\"},"
            + "{\"handlerId\":\"buddy-allocation\",\"stage\":\"buddy-allocation\"},{\"handlerId\":\"other\",\"stage\":\"notify\"}]";

    private static JsonNode j(String text) throws Exception {
        return JSON.readTree(text);
    }

    private static String outcomes(String stock, String buddy) {
        return "[{\"handlerId\":\"stock\",\"outcome\":" + stock + "},{\"handlerId\":\"buddy-allocation\",\"outcome\":" + buddy + "}]";
    }

    @Test
    void sourceStatusFollowsTheLatestTick() throws Exception {
        String ok = "{\"status\":\"ok\",\"value\":{}}";
        String pending = "{\"status\":\"pending\"}";
        String failed = "{\"status\":\"unavailable\",\"code\":\"x\"}";
        assertEquals("not-checked", ActivityChecks.sourceStatus(false, null, null, null));
        assertEquals("evidence-unavailable", ActivityChecks.sourceStatus(true, null, null, null));
        assertEquals("ok", ActivityChecks.sourceStatus(true, "completed", j(ORDER), j(outcomes(ok, ok))));
        assertEquals("unavailable", ActivityChecks.sourceStatus(true, "completed", j(ORDER), j(outcomes(ok, failed))));
        assertEquals("unavailable", ActivityChecks.sourceStatus(true, "interrupted", j(ORDER), j(outcomes(ok, ok))));
        assertEquals("delayed", ActivityChecks.sourceStatus(true, "pending", j(ORDER), j(outcomes(ok, pending))));
        assertEquals("delayed", ActivityChecks.sourceStatus(true, "running", j(ORDER), j("[]")));
        assertEquals("unavailable", ActivityChecks.sourceStatus(true, "completed", j(ORDER), j("[]")));
        assertEquals("not-checked", ActivityChecks.sourceStatus(true, "completed", j("[{\"handlerId\":\"other\",\"stage\":\"notify\"}]"), j("[]")));
    }

    @Test
    void exclusionsAreTheTopTwoEssentialsByCarsThenName() throws Exception {
        String size = "{\"code\":\"essential-unmet\",\"field\":\"size\",\"requirement\":{\"operator\":\"gte\",\"value\":5,\"junk\":{}}}";
        String fuel = "{\"code\":\"essential-unmet\",\"field\":\"fuel\",\"requirement\":{\"operator\":\"equals\",\"value\":\"electric\"}}";
        String body = "{\"code\":\"essential-unmet\",\"field\":\"body\",\"requirement\":{}}";
        JsonNode decisions = j("[{\"blockers\":[" + size + "," + fuel + "]},{\"blockers\":[" + size + "," + body + "]},"
                + "{\"blockers\":[" + size + "," + size + ",{\"code\":\"declined-unchanged\"}]}]");
        JsonNode top = ActivityChecks.exclusions(decisions);
        assertEquals(2, top.size());
        assertEquals("size", top.get(0).get("essential").textValue());
        assertEquals(3, top.get(0).get("cars").intValue());
        assertEquals("{\"operator\":\"gte\",\"value\":5}", top.get(0).get("requirement").toString());
        assertEquals("body", top.get(1).get("essential").textValue());
    }
}
