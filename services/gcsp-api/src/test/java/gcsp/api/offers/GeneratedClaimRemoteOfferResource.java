package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.remote.RemoteOperationServer;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.io.IOException;
import java.io.InputStream;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Seeds retained source inputs only; the application must produce every claim, quote, hold, offer and selection. */
public class GeneratedClaimRemoteOfferResource implements QuarkusTestResourceLifecycleManager {

    private static final ObjectMapper JSON = new ObjectMapper();
    private RemoteOperationServer remote;
    private OffersPg pg;

    @Override
    public Map<String, String> start() {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        if (url == null || url.isBlank()) {
            throw new IllegalStateException("GCSP_TEST_DATABASE_URL is required for the generated-claim test");
        }
        try {
            remote = RemoteOperationServer.start();
            pg = OffersPg.create();
            seedSources();
            Map<String, String> c = new HashMap<>();
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", url);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", pg.schema);
            c.put("quarkus.flyway.schemas", pg.schema);
            c.put("quarkus.flyway.default-schema", pg.schema);
            c.put("gcsp.environment-id", OffersPg.ENV);
            c.put("gcsp.database.expected-name", "gcsp_test_dev");
            c.put("gcsp.reset-allowed", "true");
            c.put("gcsp.buddy.execute-url", remote.baseUrl() + "/execute");
            c.put("gcsp.buddy.reconcile-url", remote.baseUrl() + "/reconcile");
            c.put("gcsp.buddy.timeout", "2s");
            return c;
        } catch (Exception e) {
            RuntimeException cleanup = closeOwnedResources();
            if (cleanup != null) e.addSuppressed(cleanup);
            throw new IllegalStateException("Generated-claim test resource failed to start", e);
        }
    }

    @Override
    public void stop() {
        RuntimeException failure = closeOwnedResources();
        if (failure != null) throw failure;
    }

    private void seedSources() throws IOException, SQLException {
        JsonNode golden = resource("/account/node-baseline/paula.json");
        JsonNode context = golden.get("context");
        String employeeId = context.get("employeeId").asText();
        String slotId = context.get("entitlementSlotId").asText();
        long employeeVersion = golden.path("input").path("employeeVersion").asLong();
        ObjectNode attributes = JSON.createObjectNode();
        for (String key : List.of("companyId", "schemeId", "gradeId", "entitlementSlotId")) {
            attributes.set(key, context.get(key));
        }
        pg.update("INSERT INTO employees (environment_id, run_id, employee_id, attributes, version) VALUES (?, ?, ?, ?::jsonb, ?)",
                OffersPg.ENV, "run-1", employeeId, attributes.toString(), employeeVersion);
        JsonNode slot = golden.path("input").path("slots").get(0);
        ObjectNode slotAttributes = slot.deepCopy();
        slotAttributes.remove(List.of("employeeId", "entitlementSlotId", "capacity", "runId", "version", "createdAt", "updatedAt"));
        pg.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes, version) "
                        + "VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)", OffersPg.ENV, "run-1", slotId, employeeId,
                slot.path("capacity").asInt(), slotAttributes.toString(), slot.path("version").asLong());
        JsonNode account = golden.path("input").get("manualContext").deepCopy();
        pg.update("INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record, version) "
                        + "VALUES (?, ?, ?, ?, ?::jsonb, ?)", OffersPg.ENV, "run-1", employeeId,
                account.path("recordSetId").asText(), account.toString(), employeeVersion);
        ObjectNode brief = JSON.createObjectNode().put("schemaVersion", 1);
        brief.putObject("preferences").putObject("body").put("value", "estate").put("importance", 100)
                .put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "employee")
                .put("confirmedAt", "2026-11-05T09:00:00.000Z");
        brief.putObject("essentials");
        ObjectNode buddy = JSON.createObjectNode().put("searchConsent", true).put("holdConsent", true)
                .put("paused", false).put("permissionVersion", 1);
        pg.update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, ?, 1)",
                OffersPg.ENV, "run-1", employeeId);
        pg.update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, "
                        + "operation, content, buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, command_id) "
                        + "VALUES (?, ?, ?, 1, NULL, 'confirmed', ?::jsonb, ?::jsonb, ?, ?, 'canonical-test', "
                        + "?::timestamptz, 'canonical-brief-v1')", OffersPg.ENV, "run-1", employeeId,
                brief.toString(), buddy.toString(), Canonical.digest(JSON.getNodeFactory().textNode("canonical-brief-v1")),
                context.path("policyVersion").asText(), "2026-11-05T09:00:00.000Z");
        JsonNode row = resource("/recommendation-source/source-cases.json").path("cases").get(0).path("rows").get(0);
        ObjectNode carAttributes = row.deepCopy();
        carAttributes.remove(List.of("orderUuid", "configurationId", "state", "available", "held", "allocated", "version"));
        pg.update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes, version) "
                        + "VALUES (?, ?, ?, ?, 'released', ?::jsonb, ?)", OffersPg.ENV, "run-1",
                row.path("orderUuid").asText(), row.path("configurationId").asText(), carAttributes.toString(),
                row.path("version").asLong());
    }

    private static JsonNode resource(String name) throws IOException {
        try (InputStream input = GeneratedClaimRemoteOfferResource.class.getResourceAsStream(name)) {
            if (input == null) throw new IOException("Missing retained fixture " + name);
            return JSON.readTree(input);
        }
    }

    private RuntimeException closeOwnedResources() {
        RuntimeException failure = null;
        if (pg != null) {
            OffersPg closing = pg;
            pg = null;
            try {
                closing.close();
            } catch (Exception e) {
                failure = new IllegalStateException("Could not close the owned generated-claim schema", e);
            }
        }
        if (remote != null) {
            RemoteOperationServer closing = remote;
            remote = null;
            try {
                closing.close();
            } catch (RuntimeException e) {
                if (failure == null) failure = e;
                else failure.addSuppressed(e);
            }
        }
        return failure;
    }
}
