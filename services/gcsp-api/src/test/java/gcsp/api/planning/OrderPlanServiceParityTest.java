package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** service-cases.json.gz: Node createOrderPlanService over scripted ports and Node's read and preview over recorded ports. */
class OrderPlanServiceParityTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Path CASES = Path.of("src/test/resources/order-plan-parity/service-cases.json.gz");
    private static final String ENV = "env-1";

    @TempDir
    Path dir;

    private static JsonNode cases() throws IOException {
        try (InputStream in = new GZIPInputStream(Files.newInputStream(CASES))) {
            return MAPPER.readTree(in);
        }
    }

    private static Principal principal(JsonNode roles, String runId, String policyVersion) {
        List<String> list = new java.util.ArrayList<>();
        roles.forEach(r -> list.add(r.textValue()));
        return new Principal("subject-1", list, ENV, runId, null, policyVersion, List.of());
    }

    /** The recorded sequence, one entry per call; the last repeats, as the generator's scripts did. */
    private static JsonNode nth(JsonNode recorded, AtomicInteger calls) {
        return recorded.get(Math.min(calls.getAndIncrement(), recorded.size() - 1));
    }

    private static PlanningClock scripted(JsonNode script) {
        AtomicInteger calls = new AtomicInteger();
        return context -> {
            JsonNode entry = nth(script, calls);
            return new PlanningClock.Observation(Instant.parse(entry.get("now").textValue()), entry.get("clockVersion").textValue());
        };
    }

    @Test
    void javaMatchesNodeCreateOrderPlanService() throws IOException {
        StringBuilder failures = new StringBuilder();
        int failed = 0;
        int count = 0;
        for (JsonNode c : cases()) {
            if (!c.get("kind").textValue().equals("service")) {
                continue;
            }
            count++;
            String id = c.get("id").textValue();
            PolicyService policy = new PolicyService(new PolicyFiles(dir, id).source(c.get("ops")));
            AtomicInteger forecastCalls = new AtomicInteger();
            AtomicInteger supplyCalls = new AtomicInteger();
            PlanningDemand demand = (read, under) -> (ObjectNode) nth(c.get("forecast"), forecastCalls).deepCopy();
            PlanningSupply supply = (read, under) -> (ObjectNode) nth(c.get("supply"), supplyCalls).deepCopy();
            OrderPlanService service = new OrderPlanService(policy, demand, supply, scripted(c.get("clock")));
            ObjectNode actual = service.readPlan(principal(c.get("roles"), c.get("runId").textValue(), c.get("policyVersion").textValue()),
                    c.get("policyVersion").textValue());
            String diff = JsonCompare.diff(c.get("expected"), actual);
            if (diff != null && failed++ < 15) {
                failures.append(id).append(" -> ").append(diff).append('\n');
            }
        }
        assertEquals(0, failed, failures.toString());
        assertTrue(count >= 25, "service case count " + count);
    }

    @Test
    void javaMatchesNodeReadAndPreviewOverRecordedPorts() throws IOException {
        JsonNode all = cases();
        JsonNode ports = null;
        for (JsonNode c : all) {
            if (c.get("kind").textValue().equals("ops-ports")) {
                ports = c;
            }
        }
        JsonNode recorded = ports;
        PolicyService policy = new PolicyService(new PolicyFiles(dir, "ops").source(MAPPER.createArrayNode()));
        PlanningDemand demand = (read, under) -> {
            JsonNode value = recorded.get("forecasts").get(read.policyVersion());
            return value == null ? Outcomes.unavailable("no-recorded-forecast:" + read.policyVersion()) : value.deepCopy();
        };
        PlanningSupply supply = (read, under) -> recorded.get("supply").deepCopy();
        JsonNode clock = recorded.get("clock");
        PlanningClock fixed = context -> new PlanningClock.Observation(Instant.parse(clock.get("now").textValue()),
                clock.get("clockVersion").textValue());
        OrderPlanOperations ops = new OrderPlanOperations(policy, demand, supply, fixed, (context, plan) -> Outcomes.object().put("status", "no-submission"));
        StringBuilder failures = new StringBuilder();
        int failed = 0;
        int count = 0;
        for (JsonNode c : all) {
            if (!c.get("kind").textValue().equals("ops")) {
                continue;
            }
            count++;
            Principal who = principal(c.get("roles"), recorded.get("runId").textValue(), recorded.get("policyVersion").textValue());
            ObjectNode actual = c.get("op").textValue().equals("read") ? ops.readPlan(who) : ops.previewPlan(who, c.get("input"));
            if (Outcomes.isOk(actual)) {
                ObjectNode value = (ObjectNode) actual.get("value");
                assertEquals("learned-forecast-not-configured", value.get("learned").get("reason").textValue());
                assertEquals("unavailable", value.get("learned").get("status").textValue());
                value.remove("learned");
            }
            String diff = JsonCompare.diff(c.get("expected"), actual);
            if (diff != null && failed++ < 15) {
                failures.append(c.get("id").textValue()).append(" -> ").append(diff).append('\n');
            }
        }
        assertEquals(0, failed, failures.toString());
        assertTrue(count >= 25, "ops case count " + count);
    }
}
