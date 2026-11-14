package gcsp.api.brief;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;

/** Test helpers over a fixture: build editable briefs the way the Account editor would, and read versions. */
final class Harness {

    final BriefFixture f;

    Harness(BriefFixture f) {
        this.f = f;
    }

    static ObjectNode obj() {
        return Json.obj();
    }

    static ArrayNode list(String... values) {
        ArrayNode a = Json.arr();
        for (String v : values) a.add(v);
        return a;
    }

    JsonNode ok(BriefResult r) {
        return assertInstanceOf(BriefResult.Ok.class, r, String.valueOf(r)).value();
    }

    BriefResult.Refusal refused(BriefResult r, int http, String code) {
        BriefResult.Refusal x = assertInstanceOf(BriefResult.Refusal.class, r, String.valueOf(r));
        assertEquals(http, x.httpStatus(), x.toString());
        assertEquals(code, x.code(), x.toString());
        return x;
    }

    /** A new employee's sparse content: policy essentials stay unconfirmed and no default preference is invented. */
    ObjectNode sparse() {
        ObjectNode b = ((ObjectNode) ok(f.service.resolveInitial(f.scope)).get("initial")).deepCopy();
        b.set("preferences", obj());
        return b;
    }

    static ObjectNode choose(ObjectNode brief, String key, JsonNode value, int importance) {
        ObjectNode p = obj();
        p.set("value", value);
        p.put("importance", importance).put("valueState", "draft").put("importanceState", "draft").put("source", "employee");
        ((ObjectNode) brief.get("preferences")).set(key, p);
        return brief;
    }

    /** body, sportiness and economy: three considered categories, the registered minimum. */
    ObjectNode three() {
        ObjectNode b = sparse();
        choose(b, "body", list("saloon", "estate"), 50);
        choose(b, "sportiness", Json.M.getNodeFactory().numberNode(50), 50);
        return choose(b, "economy", Json.M.getNodeFactory().numberNode(50), 50);
    }

    long briefVersion() {
        return ok(f.service.resolveInitial(f.scope)).get("briefVersion").longValue();
    }

    long draftVersion() {
        return ok(f.service.resolveInitial(f.scope)).get("draftVersion").longValue();
    }

    /** A command envelope at the current versions. */
    ObjectNode at(String id) {
        return envelope(id, briefVersion(), draftVersion());
    }

    static ObjectNode envelope(String id, long brief, long draft) {
        return obj().put("commandId", id).put("expectedBriefVersion", brief).put("expectedDraftVersion", draft);
    }

    BriefResult save(ObjectNode brief) {
        return f.service.saveDraft(f.scope, at(f.nextId()).set("brief", brief));
    }

    JsonNode saveOk(ObjectNode brief) {
        return ok(save(brief));
    }

    BriefResult engage() {
        return f.service.engage(f.scope, at(f.nextId()));
    }

    JsonNode engageOk() {
        return ok(engage());
    }

    /** Draft three categories and engage them: Buddy engaged at brief version 1, draft version 1. */
    void engaged() {
        saveOk(three());
        engageOk();
    }

    JsonNode current() {
        return ok(f.service.current(f.scope));
    }

    long permissionVersion() {
        return current().get("brief").get("buddy").get("permissionVersion").longValue();
    }

    String contractId() {
        return "contract-1";
    }

    ObjectNode sameAgain(boolean on) {
        return obj().put("on", on).put("contractId", contractId()).put("source", "employee").put("setAt", "2026-11-13T09:00:00Z");
    }

    String operation(long version) throws SQLException {
        return f.text("SELECT operation FROM briefs WHERE brief_version = " + version);
    }
}
