package gcsp.api.brief;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** brief/preview over the fixture schema: saved-version checks before and after, brief validation and the pass-through. */
class BriefPreviewTest {

    BriefFixture f;
    Harness h;
    final List<ObjectNode> seen = new ArrayList<>();
    Function<ObjectNode, ObjectNode> port = in -> ok("no-stock");
    BriefService service;

    @BeforeEach
    void setUp() throws SQLException {
        f = BriefFixture.create();
        h = new Harness(f);
        service = new BriefService(f.pool(), f.policy, f.account, f.offers, (scope, in) -> {
            seen.add(in);
            return port.apply(in);
        }, Clock.fixed(BriefFixture.NOW, ZoneOffset.UTC));
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    private static ObjectNode ok(String state) {
        ObjectNode o = Json.obj();
        o.put("status", "ok").set("value", PreviewShapes.value(state));
        o.put("contractVersion", "1.0.0");
        return o;
    }

    private ObjectNode request() {
        return PreviewShapes.request(h.briefVersion(), h.draftVersion(), h.three());
    }

    private BriefResult.Refusal refused(BriefResult r, int http, String code) {
        return h.refused(r, http, code);
    }

    @Test
    void anOkOutcomeIsPassedThroughWithItsContractVersionAndTheRequestIsTranslated() throws Exception {
        h.saveOk(h.three());
        ObjectNode req = request();
        List<Long> before = f.snapshot();
        BriefResult.Ok r = assertInstanceOf(BriefResult.Ok.class, service.preview(f.scope, req));
        assertTrue(PreviewShapes.previewShape(r.value()));
        assertEquals("1.0.0", r.contractVersion());
        ObjectNode sent = seen.get(0);
        assertEquals(List.of("baseBriefVersion", "baseDraftVersion", "brief"), sorted(sent));
        assertEquals(h.briefVersion(), sent.get("baseBriefVersion").longValue());
        assertEquals(h.draftVersion(), sent.get("baseDraftVersion").longValue());
        assertEquals(req.get("brief"), sent.get("brief"));
        assertEquals(before, f.snapshot(), "preview stores nothing");
    }

    private static List<String> sorted(ObjectNode n) {
        List<String> names = new ArrayList<>();
        n.fieldNames().forEachRemaining(names::add);
        names.sort(null);
        return names;
    }

    @Test
    void staleBriefOrDraftVersionsAreRefusedBeforeTheRecommendationRuns() {
        h.saveOk(h.three());
        long draft = h.draftVersion();
        BriefResult.Refusal brief = refused(service.preview(f.scope, PreviewShapes.request(5, draft, h.three())), 409, "stale-version");
        assertEquals(5, brief.body().get("expectedVersion").intValue());
        assertEquals(h.briefVersion(), brief.body().get("currentVersion").longValue());
        assertEquals("briefs", brief.body().get("resource").get("table").asText());
        BriefResult.Refusal draftStale = refused(service.preview(f.scope, PreviewShapes.request(h.briefVersion(), draft + 3, h.three())),
                409, "stale-version");
        assertEquals("brief-draft", draftStale.body().get("resource").get("table").asText());
        assertTrue(seen.isEmpty());
    }

    @Test
    void anUnregisteredBriefIsInvalidPreviewNamingBrief() {
        ObjectNode bad = h.three();
        ((ObjectNode) bad.get("preferences")).remove("body");
        ((ObjectNode) bad.get("preferences").get("sportiness")).put("importance", 500);
        BriefResult.Refusal r = refused(service.preview(f.scope, PreviewShapes.request(0, 0, bad)), 400, "invalid-preview");
        assertEquals("brief", r.body().get("reasons").get(0).get("field").asText());
        ObjectNode unknown = h.three();
        unknown.putObject("surprise");
        refused(service.preview(f.scope, PreviewShapes.request(0, 0, unknown)), 400, "invalid-preview");
        ObjectNode noBrief = PreviewShapes.request(0, 0, bad);
        noBrief.remove("brief");
        refused(service.preview(f.scope, noBrief), 400, "invalid-preview");
        assertTrue(seen.isEmpty());
    }

    @Test
    void aSaveDuringTheEvaluationMakesTheResultStale() {
        port = in -> {
            h.saveOk(h.three());
            return ok("no-stock");
        };
        BriefResult.Refusal r = refused(service.preview(f.scope, PreviewShapes.request(0, 0, h.three())), 409, "stale-version");
        assertEquals("brief-draft", r.body().get("resource").get("table").asText());
        assertEquals(0, r.body().get("expectedVersion").intValue());
        assertEquals(1, r.body().get("currentVersion").intValue());
    }

    @Test
    void nonOkOutcomesKeepTheirStatusCodeAndBody() {
        for (Object[] c : new Object[][] {{"invalid", 400}, {"forbidden", 403}, {"stale-run", 409}, {"unavailable", 503}}) {
            port = in -> Json.obj().put("status", (String) c[0]).put("code", "x-" + c[0]).put("contractVersion", "1.0.0");
            BriefResult.Raw r = assertInstanceOf(BriefResult.Raw.class, service.preview(f.scope, PreviewShapes.request(0, 0, h.three())));
            assertEquals(c[1], r.httpStatus());
            assertEquals("x-" + c[0], r.body().get("code").asText());
            assertEquals("1.0.0", r.body().get("contractVersion").asText());
        }
    }

    @Test
    void aThrowingPortIsUnavailable() {
        port = in -> {
            throw new IllegalStateException("source down");
        };
        refused(service.preview(f.scope, PreviewShapes.request(0, 0, h.three())), 503, "brief-unavailable");
    }

    @Test
    void anUnwiredPortIsUnavailableProviderNotConfigured() {
        BriefService plain = f.service;
        BriefResult.Raw r = assertInstanceOf(BriefResult.Raw.class, plain.preview(f.scope, PreviewShapes.request(0, 0, h.three())));
        assertEquals(503, r.httpStatus());
        assertEquals("provider-not-configured", r.body().get("code").asText());
    }
}
