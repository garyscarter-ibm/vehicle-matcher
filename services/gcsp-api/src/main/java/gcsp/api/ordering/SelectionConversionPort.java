package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Tx;
import java.time.Instant;

/**
 * The source authority's side of a selection (manual cart, Buddy offer). It owns validation and allocation of the
 * exact hold, quote and stock; ordering owns the intent, the handoff and the record.
 */
public interface SelectionConversionPort {

    /** The source type this converter serves: cart or buddy-offer. */
    String sourceType();

    /** Reads what the selection needs (draft mode, driver, contact, source versions) outside any transaction. */
    Preparation prepare(OrderingScope scope, SourceInput source);

    /** Runs INSIDE the ordering transaction: validates and allocates the hold, quote and stock, or refuses. */
    Conversion convert(Tx tx, OrderingScope scope, ConversionRequest request) throws Exception;

    record SourceInput(String type, String holdId, long expectedHoldVersion, long expectedDraftVersion) {}

    record ConversionRequest(String holdId, long expectedHoldVersion, long expectedDraftVersion,
            String expectedQuoteId, long expectedStockVersion, String operationId, Instant now) {}

    sealed interface Preparation permits Prepared, Refusal {}

    sealed interface Conversion permits Converted, Refusal {}

    /** mode is new or replacement; driver, contact, employee and sourceVersions are stored in the snapshot. */
    record Prepared(String mode, JsonNode driver, JsonNode contact, JsonNode employee, JsonNode sourceVersions)
            implements Preparation {}

    /** quote must carry quoteId; stockFacts are the exact car facts the quote was priced on. */
    record Converted(String orderUuid, String orderNumber, String configurationId, JsonNode quote,
            JsonNode stockFacts, String renewalId) implements Conversion {}

    /** A typed refusal such as claim-changed, quote-expired, stock-changed or draft-review-required. */
    record Refusal(String code) implements Preparation, Conversion {}
}
