package gcsp.api.brief;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import org.junit.jupiter.api.Test;

/** Preview request validation and outcome mapping that need no database (the envelope is checked before any read). */
class BriefPreviewEnvelopeTest {

    private static final BriefScope SCOPE = new BriefScope("e", "run-1", "emp-1", "p", BriefFixture.POLICY);
    private static final BriefService SERVICE = new BriefService(null, v -> java.util.Optional.empty(),
            new BriefFixture.Account(), new BriefFixture.Offers(), (s, i) -> BriefPreviewPort.unconfigured(), Clock.systemUTC());

    private static BriefResult.Refusal refused(JsonNode input) {
        return assertInstanceOf(BriefResult.Refusal.class, SERVICE.preview(SCOPE, input));
    }

    private static ObjectNode valid() {
        return PreviewShapes.request(0, 0, Json.obj().put("schemaVersion", 1));
    }

    @Test
    void anythingButTheExactEnvelopeIsInvalidPreview() {
        for (JsonNode bad : new JsonNode[] {null, Json.arr(), Json.obj(), valid().put("extra", 1), valid().put("kind", "saved"),
                valid().put("baseBriefVersion", -1), valid().put("draftVersion", 1.5), valid().put("baseBriefVersion", "0"),
                valid().put("draftVersion", 9007199254740993.0)}) {
            BriefResult.Refusal r = refused(bad);
            assertEquals(400, r.httpStatus(), String.valueOf(bad));
            assertEquals("invalid-preview", r.code());
            assertEquals("preview", r.body().get("reasons").get(0).get("field").asText());
        }
    }

    @Test
    void aWellFormedEnvelopeWithoutPolicyIsUnavailable() {
        BriefResult.Refusal r = refused(valid());
        assertEquals(503, r.httpStatus());
        assertEquals("brief-unavailable", r.code());
    }

    @Test
    void theAngularShapeMirrorAcceptsAStateOnlyWhenItsDecisionsAgree() {
        assertTrue(PreviewShapes.previewShape(PreviewShapes.value("no-stock")));
        assertFalse(PreviewShapes.previewShape(PreviewShapes.value("recommendations")));
        assertFalse(PreviewShapes.previewShape(PreviewShapes.value("no-viable-stock")));
        assertFalse(PreviewShapes.previewShape(Json.obj().put("state", "other")));
    }
}
