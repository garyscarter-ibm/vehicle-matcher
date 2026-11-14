package gcsp.api.documents;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.documents.DocumentProviderPort.Acknowledgement;
import gcsp.api.documents.DocumentProviderPort.Operation;
import gcsp.api.documents.DocumentProviderPort.Result;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class DocumentProviderTest {

    private static final Instant OPENED = Instant.parse("2026-11-14T09:00:00Z");
    private static final Instant PROGRESS = Instant.parse("2026-11-14T10:00:00Z");
    private static final String FAILURE = "The provider reported this step as failed.";
    private static final String OPERATION = "abcdefghijklmnop";

    private static Operation operation(boolean fail) {
        return new Operation(OPERATION, "run-1", "order-1", "licence-check", fail, FAILURE, OPENED, PROGRESS);
    }

    private static Acknowledgement acknowledgement() {
        return new Acknowledgement(OPERATION, "run-1", "order-1", "licence-check", "E-1001",
                Instant.parse("2026-11-14T11:00:00Z"));
    }

    private static void assertResult(Result result, String status, String reason) {
        assertEquals(status, result.status());
        assertEquals(reason, result.reason());
        assertNull(result.providerReference());
        assertNull(result.evidence());
    }

    private static void assertInvalid(Result result) {
        assertResult(result, "unsupported", "invalid-document-operation");
    }

    @Test
    void syntheticStartIsAcceptedWithAReferenceFromTheOperation() {
        Result result = new SyntheticDocumentProvider().start(operation(false));
        assertEquals("accepted", result.status());
        assertEquals(OPERATION, result.operationId());
        assertEquals("SYN-DOC-ABCDEFGHIJKL", result.providerReference());
        assertNull(result.reason());
        assertNull(result.evidence());
    }

    @Test
    void syntheticProgressIsInProgressBeforeProgressAt() {
        SyntheticDocumentProvider provider = new SyntheticDocumentProvider();
        assertEquals("in-progress", provider.progress(operation(false), OPENED.plusSeconds(60)).status());
        assertEquals("in-progress", provider.progress(operation(true), PROGRESS.minusMillis(1)).status());
    }

    @Test
    void syntheticProgressCompletesAtProgressAt() {
        Result result = new SyntheticDocumentProvider().progress(operation(false), PROGRESS);
        assertEquals("complete", result.status());
        assertEquals(OPERATION, result.operationId());
        assertNull(result.reason());
    }

    @Test
    void syntheticProgressFailsWithTheScenarioReasonWhenSelected() {
        Result result = new SyntheticDocumentProvider().progress(operation(true), PROGRESS.plusSeconds(1));
        assertEquals("failed", result.status());
        assertEquals(FAILURE, result.reason());
    }

    @Test
    void syntheticAcknowledgementRecordsEvidenceThatIsNotASignature() {
        Result result = new SyntheticDocumentProvider().acknowledge(acknowledgement());
        assertEquals("acknowledged", result.status());
        assertEquals("SYN-ACK-ABCDEFGHIJKL", result.providerReference());
        assertEquals("synthetic-acknowledgement", result.evidence().get("kind").asText());
        assertEquals("Acknowledged. Not a signature.", result.evidence().get("label").asText());
        assertEquals(OPERATION, result.evidence().get("operationId").asText());
        assertEquals("2026-11-14T11:00:00Z", result.evidence().get("at").asText());
        assertEquals("E-1001", result.evidence().get("actorId").asText());
        assertEquals("SYN-ACK-ABCDEFGHIJKL", result.evidence().get("providerReference").asText());
        assertTrue(result.evidence().get("fictional").asBoolean());
    }

    @Test
    void syntheticProviderSupportsAcknowledgement() {
        SyntheticDocumentProvider provider = new SyntheticDocumentProvider();
        assertEquals("synthetic", provider.mode());
        assertTrue(provider.supportsAcknowledgement());
    }

    @Test
    void syntheticProviderRefusesInvalidInputRatherThanInventingAnOutcome() {
        SyntheticDocumentProvider provider = new SyntheticDocumentProvider();
        Operation blankItem = new Operation(OPERATION, "run-1", "order-1", " ", false, FAILURE, OPENED, PROGRESS);
        assertInvalid(provider.start(blankItem));
        assertInvalid(provider.progress(blankItem, PROGRESS));
        assertInvalid(provider.start(null));
        Operation longItem = new Operation(OPERATION, "run-1", "order-1", "x".repeat(513), false, FAILURE, OPENED,
                PROGRESS);
        assertInvalid(provider.start(longItem));
        assertInvalid(provider.progress(operation(false), null));
        Operation noProgress = new Operation(OPERATION, "run-1", "order-1", "licence-check", false, FAILURE, OPENED,
                null);
        assertInvalid(provider.progress(noProgress, PROGRESS));
        assertInvalid(provider.acknowledge(new Acknowledgement(OPERATION, "run-1", "order-1", "licence-check", " ",
                PROGRESS)));
        assertInvalid(provider.acknowledge(new Acknowledgement(OPERATION, "run-1", "order-1", "licence-check",
                "E-1001", null)));
    }

    @Test
    void unsupportedProviderRefusesEveryOperation() {
        UnsupportedDocumentProvider provider = new UnsupportedDocumentProvider();
        assertEquals("unsupported", provider.mode());
        assertFalse(provider.supportsAcknowledgement());
        String reason = "Live document and readiness writes are not supported yet.";
        assertResult(provider.start(operation(false)), "unsupported", reason);
        assertResult(provider.progress(operation(false), PROGRESS), "unsupported", reason);
        assertResult(provider.acknowledge(acknowledgement()), "unsupported", reason);
    }

    @Test
    void unconfiguredProviderReportsUnavailable() {
        UnconfiguredDocumentProvider provider = new UnconfiguredDocumentProvider();
        assertEquals("none", provider.mode());
        assertFalse(provider.supportsAcknowledgement());
        String reason = "document-provider-not-configured";
        assertResult(provider.start(operation(false)), "unavailable", reason);
        assertResult(provider.progress(operation(false), PROGRESS), "unavailable", reason);
        assertResult(provider.acknowledge(acknowledgement()), "unavailable", reason);
    }

    @Test
    void selectionChoosesTheNamedProvider() {
        assertInstanceOf(UnconfiguredDocumentProvider.class, DocumentProviderSelection.select(null));
        assertInstanceOf(UnconfiguredDocumentProvider.class, DocumentProviderSelection.select(" "));
        assertInstanceOf(UnconfiguredDocumentProvider.class, DocumentProviderSelection.select("none"));
        assertInstanceOf(SyntheticDocumentProvider.class, DocumentProviderSelection.select("synthetic"));
        assertInstanceOf(UnsupportedDocumentProvider.class, DocumentProviderSelection.select("unsupported"));
    }

    @Test
    void unknownProviderNameFailsAtStartup() {
        IllegalStateException failure = assertThrows(IllegalStateException.class,
                () -> DocumentProviderSelection.select("live"));
        assertEquals("Unknown gcsp.documents.provider 'live'; supported: none, synthetic, unsupported",
                failure.getMessage());
    }
}
