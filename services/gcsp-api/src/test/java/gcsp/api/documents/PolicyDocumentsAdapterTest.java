package gcsp.api.documents;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The documents policy port over the canonical PolicyService and retained seed: no fixture, no default. */
class PolicyDocumentsAdapterTest {

    private static PolicyDocumentsAdapter adapter(String runId) {
        return new PolicyDocumentsAdapter(new PolicyService(new RetainedFilePolicySource()),
                (ctx) -> Instant.parse("2026-11-06T12:00:00Z"), Optional.of("isolated-dev"), Optional.of(runId));
    }

    @Test
    void theRetainedSeedLoadsTheDocumentPolicy() {
        DocumentPolicy.Load load = DocumentPolicy.load(adapter("run-1"), "gcsp-policy-v1");
        DocumentPolicy.Config config = assertInstanceOf(DocumentPolicy.Load.Loaded.class, load).config();
        assertEquals("sent to ordering", config.openingStage());
        assertTrue(config.items().stream().anyMatch((i) -> "employee".equals(i.owner())));
        assertEquals(3, config.assumptions().size());
    }

    @Test
    void anUnknownVersionOrMissingRunIsUnavailable() {
        assertInstanceOf(DocumentPolicy.Load.Unavailable.class, DocumentPolicy.load(adapter("run-1"), "nope-v9"));
        assertInstanceOf(DocumentPolicy.Load.Unavailable.class, DocumentPolicy.load(adapter(""), "gcsp-policy-v1"));
    }
}
