package gcsp.api.cases;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Result assertions and command builders shared by the case tests. */
final class CaseHarness {

    private CaseHarness() {}

    static JsonNode ok(CaseResult r) {
        return assertInstanceOf(CaseResult.Ok.class, r, String.valueOf(r)).value();
    }

    static CaseResult.Refusal refused(CaseResult r, int http, String code) {
        CaseResult.Refusal x = assertInstanceOf(CaseResult.Refusal.class, r, String.valueOf(r));
        assertEquals(http, x.httpStatus(), x.toString());
        assertEquals(code, x.code(), x.toString());
        return x;
    }

    static ObjectNode request(String id, String reason) {
        return CaseJson.obj().put("commandId", id).put("reason", reason);
    }

    /** Opens Paula's case and returns it. */
    static JsonNode open(CaseFixture f) {
        return ok(f.service.requestHelp(f.paula, request(f.nextId(), "My replacement may miss my contract end."))).get("case");
    }

    static ObjectNode update(CaseFixture f, JsonNode c, String status) {
        return CaseJson.obj().put("commandId", f.nextId()).put("caseId", c.get("caseId").asText())
                .put("expectedVersion", c.get("version").asLong()).put("status", status)
                .put("reason", "Scheme team reviewed the renewal.").put("nextAction", "Review options with Paula.")
                .put("dueAt", "2026-11-06T12:00:00.000Z");
    }

    static ObjectNode manual(String decision) {
        return CaseJson.obj().put("type", "manual-decision").put("decision", decision);
    }

    /** Applies an update and returns the case it produced. */
    static JsonNode move(CaseFixture f, JsonNode c, String status) {
        ObjectNode u = update(f, c, status);
        if (status.equals("remedy-proposed") || status.equals("resolved")) u.set("remedy", manual("Agreed with Paula"));
        return ok(f.service.update(f.greg, u)).get("case");
    }
}
