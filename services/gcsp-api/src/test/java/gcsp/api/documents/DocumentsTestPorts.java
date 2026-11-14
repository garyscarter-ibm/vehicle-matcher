package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.RunContext;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Test-only policy, case and clock ports with settable state, standing in for the sibling Stories' real ones. */
final class DocumentsTestPorts {

    static final Map<String, String> OWNERS = new ConcurrentHashMap<>();
    static volatile Instant now = Instant.parse("2026-11-14T09:00:00Z");

    private DocumentsTestPorts() {}

    @Alternative
    @Priority(1)
    @ApplicationScoped
    public static class Policy implements DocumentPolicyPort {
        private final JsonNode root = read();

        private static JsonNode read() {
            try {
                return new ObjectMapper().readTree(Files.readString(
                        Path.of("../../server/test/fixtures/gcsp-lifecycle-documents-policy-patch.json")));
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
        }

        @Override
        public Optional<Assumption> assumption(String key, String policyVersion) {
            for (JsonNode row : root.get("assumptions")) {
                if (key.equals(row.get("key").asText())) {
                    return Optional.of(new Assumption(key, row.get("value"), row.get("unit").asText(),
                            row.get("status").asText(), row.get("basis").asText(), row.get("source").asText(),
                            row.get("sourceDate").asText(), policyVersion));
                }
            }
            return Optional.empty();
        }
    }

    @Alternative
    @Priority(1)
    @ApplicationScoped
    public static class Cases implements DocumentCasePort {
        @Override
        public StageRead readStage(RunContext ctx, String orderUuid) {
            return new StageRead("not-found", null, null);
        }

        @Override
        public OrderList listOrders(RunContext ctx) {
            return new OrderList("ok", null, List.of(), List.of(), 0);
        }

        @Override
        public CaseCheck checkCase(RunContext ctx, String employeeId, OrderAuthority order) {
            return new CaseCheck.Unavailable("not-used-by-these-tests");
        }

        @Override
        public Owner ownerOf(RunContext ctx, String orderUuid) {
            String owner = OWNERS.get(orderUuid);
            return owner == null ? new Owner.NotFound() : new Owner.Owned(owner);
        }
    }

    @Alternative
    @Priority(1)
    @ApplicationScoped
    public static class Clock implements DocumentClock {
        @Override
        public Optional<Instant> now(RunContext ctx) {
            return Optional.of(now);
        }
    }
}
