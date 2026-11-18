package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class ReviewedDefinitionsTest {

    /** The digest the Node server computes for the same combined set (reviewed-definitions.js). */
    static final String NODE_DIGEST = "6500358765488d86091f1bdf7e5b6cdd2f1b740869df468f63cd23a6834cf7c4";

    @Test
    void theCombinedOfferJourneySetHasTheDigestNodeComputes() throws Exception {
        ObjectNode set = ReviewedDefinitions.get("offer-journey-v1");
        assertEquals(NODE_DIGEST, set.get("digest").textValue());
        assertEquals("offer-journey-v1", set.get("definitionSetId").textValue());
        assertEquals("offer.declineReasons.v1", set.get("definitions").get(0).get("key").textValue());
        assertEquals("offer.followupQuestions.v1", set.get("definitions").get(1).get("key").textValue());
        assertEquals(2, set.get("definitions").size());
    }

    @Test
    void anUnknownSetIsNotAdoptable() throws Exception {
        assertNull(ReviewedDefinitions.get("presenter-controls-v1"));
        assertNull(ReviewedDefinitions.get(null));
    }

    @Test
    void theSuccessorAddsTheReasonRuleWhileTheRetainedJourneyStaysReadable() throws Exception {
        ObjectNode old = ReviewedDefinitions.get("offer-journey-v1");
        ObjectNode next = ReviewedDefinitions.get("offer-journey-v2");
        assertTrue(next != null, "The new run must be able to adopt the re-entry rule.");
        assertEquals(old.get("definitions").get(0), next.get("definitions").get(0));
        assertEquals(old.get("definitions").get(1), next.get("definitions").get(1));
        assertEquals("offer.declinedCar.reentry.v1", next.get("definitions").get(2).get("key").textValue());
        assertEquals(3, next.get("definitions").size());
        assertEquals(NODE_DIGEST, old.get("digest").textValue());
        assertTrue(ReviewedDefinitions.valid(next));
    }

    @Test
    void aBundleWithTheWrongDigestKeysOrRowsIsInvalid() throws Exception {
        ObjectNode set = ReviewedDefinitions.get("offer-journey-v1");
        assertTrue(ReviewedDefinitions.valid(set));
        ObjectNode tampered = set.deepCopy();
        tampered.put("revision", "2");
        assertFalse(ReviewedDefinitions.valid(tampered));
        ObjectNode extra = set.deepCopy();
        extra.put("extra", 1);
        assertFalse(ReviewedDefinitions.valid(extra));
        ObjectNode status = set.deepCopy();
        ((ObjectNode) status.get("definitions").get(0)).put("status", "invented");
        assertFalse(ReviewedDefinitions.valid(status));
    }
}
