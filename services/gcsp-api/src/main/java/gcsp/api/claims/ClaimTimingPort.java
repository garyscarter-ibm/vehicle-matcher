package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** Hold timing from policy, read at claim time and pinned into the quote. No defaults: anything missing is unavailable. */
public interface ClaimTimingPort {

    Timing timing(ClaimScope scope, Instant now);

    sealed interface Timing {}

    /** previewSeconds and reviewSeconds are positive; assumptions are the policy rows they came from. */
    record Known(long previewSeconds, long reviewSeconds, JsonNode assumptions) implements Timing {}

    record Unavailable(String code) implements Timing {}
}
