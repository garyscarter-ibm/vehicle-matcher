package gcsp.api.recommendation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.HrSnapshotRecords;
import gcsp.api.account.SourceResult;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import gcsp.api.supply.ReleaseResult;
import gcsp.api.supply.ReleasedStock;
import gcsp.api.supply.StockRelease;
import gcsp.api.supply.SupplySelection;
import gcsp.api.supply.TickEvent;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.postgresql.ds.PGSimpleDataSource;

/** One retained employee and two retained stock rows, reshaped at the provider boundary. */
final class ProviderShapeVariationSupport {

    private ProviderShapeVariationSupport() {}

    static ObjectNode brief() {
        ObjectNode brief = RecommendationDb.JSON.createObjectNode().put("schemaVersion", 1).put("briefVersion", 1);
        brief.putObject("preferences");
        brief.putObject("essentials");
        return brief;
    }

    static JsonNode stockRows() throws IOException {
        return RecommendationDb.resource("/recommendation-source/source-cases.json").get("cases").get(0).get("rows");
    }

    static ObjectNode plan() throws IOException {
        ObjectNode plan = (ObjectNode) RecommendationDb.resource("/supply/tranche-plan.json").deepCopy();
        ArrayNode stock = ((ObjectNode) plan.get("windows").get(0)).putArray("stock");
        JsonNode rows = stockRows();
        for (int index : List.of(0, 2)) {
            JsonNode row = rows.get(index);
            ObjectNode car = stock.addObject();
            for (String key : List.of("orderUuid", "orderNumber", "configurationId", "visibility", "facts")) {
                car.set(key, row.get(key).deepCopy());
            }
            car.putObject("availability").set("availableUntil", row.get("release").get("availability").get("availableUntil"));
        }
        return plan;
    }

    static Path write(Path dir, String name, JsonNode value) throws IOException {
        Path file = dir.resolve(name + ".json");
        Files.writeString(file, value.toString());
        return file;
    }

    /** The Paula golden has identical current-contract and history rows, so no alternate renewal mapping is needed. */
    static ObjectNode hrExport() throws IOException {
        JsonNode golden = RecommendationDb.golden("paula");
        JsonNode context = golden.get("context");
        JsonNode record = golden.get("input").get("manualContext");
        JsonNode account = record.get("account");
        assertEquals(record.get("contracts").get(0), record.get("histories").get(0).get("entries").get(0));
        ObjectNode root = RecommendationDb.JSON.createObjectNode().put("schema", HrSnapshotRecords.SCHEMA);
        root.putObject("extract").put("environment", SourceFixture.ENV).put("run", SourceFixture.RUN)
                .put("generatedAt", SourceFixture.NOW);
        ObjectNode person = root.putArray("people").addObject();
        copy(person, account, "employeeRef", "employeeId", "displayName", "name", "staffNumber", "employeeNumber",
                "home", "address", "reach", "contact", "allowanceOverride", "allowanceOverride");
        person.set("personnelNumber", context.get("employeeId"));
        copy(person.putObject("membership"), context, "company", "companyId", "scheme", "schemeId",
                "grade", "gradeId", "entitlementSlot", "entitlementSlotId");
        person.set("recordSet", record.get("recordSetId"));
        person.set("recordVersion", golden.get("input").get("employeeVersion"));
        person.set("provenance", provenance(record.get("source")));
        person.set("facts", record.get("employeeFacts").deepCopy());
        ArrayNode holders = person.putArray("licenceHolders");
        for (JsonNode driver : record.get("drivers")) {
            ObjectNode holder = holders.addObject();
            copy(holder, driver, "id", "driverId", "name", "name", "kind", "kind",
                    "relationship", "relationship", "eligible", "eligible");
            JsonNode licence = driver.get("licence");
            ObjectNode mapped = holder.putObject("licence");
            copy(mapped, licence, "number", "displayNumber", "classes", "categories", "from", "validFrom", "to", "validUntil");
            mapped.set("provenance", provenance(licence.get("source")));
        }
        ArrayNode agreements = person.putArray("agreements");
        ArrayNode empty = person.putArray("schemesWithoutHistory");
        for (JsonNode history : record.get("histories")) {
            if (history.get("entries").isEmpty()) empty.add(history.get("schemeId"));
            for (JsonNode entry : history.get("entries")) {
                ObjectNode agreement = agreements.addObject();
                copy(agreement, entry, "id", "contractId", "scheme", "schemeId", "slot", "slotId", "driver", "driverId",
                        "state", "status", "vehicle", "vehicle", "model", "model", "media", "media");
                copy(agreement.putObject("dates"), entry, "collected", "actualCollectionDate", "ends", "contractEndDate",
                        "returned", "returnedDate", "earliest", "earliestCollectionDate", "latest", "latestCollectionDate");
                ObjectNode mileage = agreement.putObject("mileage");
                copy(mileage, entry, "annual", "annualMileage", "unit", "mileageUnit", "months", "months", "odometer", "currentOdometer");
                if (mileage.isEmpty()) agreement.remove("mileage");
                agreement.set("provenance", provenance(entry.get("source")));
            }
        }
        ArrayNode entitlements = person.putArray("entitlements");
        for (JsonNode slot : golden.get("input").get("slots")) {
            copy(entitlements.addObject(), slot, "slot", "entitlementSlotId", "capacity", "capacity",
                    "employeeCapacity", "employeeCapacity", "contract", "contractId", "renewal", "renewalId",
                    "state", "state", "version", "version", "createdAt", "createdAt", "updatedAt", "updatedAt");
        }
        return root;
    }

    static ObjectNode driverFlag(ObjectNode export) {
        return (ObjectNode) export.get("people").get(0).get("licenceHolders").get(0).get("eligible");
    }

    private static ObjectNode provenance(JsonNode source) {
        ObjectNode out = RecommendationDb.JSON.createObjectNode();
        copy(out, source, "kind", "mode", "ref", "sourceRef", "version", "sourceVersion",
                "schema", "schemaVersion", "effective", "effectiveFrom", "observed", "observedAt");
        return out;
    }

    private static void copy(ObjectNode to, JsonNode from, String... pairs) {
        for (int i = 0; i < pairs.length; i += 2) {
            if (from.has(pairs[i + 1])) to.set(pairs[i], from.get(pairs[i + 1]).deepCopy());
        }
    }

    private static ObjectNode releasePolicy(PolicyService policy) throws IOException {
        RecommendationContext context = SourceFixture.context("paula");
        PolicyRead read = new PolicyRead(context.runId(), SourceFixture.NOW, context.policyVersion());
        ObjectNode file = RecommendationDb.JSON.createObjectNode().put("policyVersion", context.policyVersion());
        ArrayNode assumptions = file.putArray("assumptions");
        for (String key : List.of("supply.release.size", "supply.leadTimeDays", "supply.stockSource.maxAgeMinutes")) {
            PolicyResult result = policy.getAssumption(key, read);
            assertTrue(result.ok(), () -> result.body().toString());
            assertEquals(context.policyVersion(), result.policyVersion());
            assumptions.add(result.value());
        }
        file.set("effectiveFrom", assumptions.get(0).get("effectiveFrom"));
        return file;
    }

    record Composed(RecommendationContext context, ReleasedStockRecommendationSource source, RecommendationService service) {
        ObjectNode recommend(JsonNode brief) {
            return service.recommend(context, brief);
        }
    }

    static Composed compose(Path hr, Db db, PolicyService policy) throws IOException {
        AccountRecordsPort records = HrSnapshotRecords.open(hr.toString());
        RecommendationContext identity = SourceFixture.context("paula");
        SourceResult employment = records.readEmployment(identity.environmentId(), identity.runId(), identity.employeeId());
        assertTrue(employment.isOk(), "HR membership must resolve before computing recommendations");
        JsonNode member = employment.value();
        RecommendationContext context = new RecommendationContext(identity.runId(), identity.environmentId(), identity.employeeId(),
                member.get("companyId").asText(), member.get("schemeId").asText(), member.get("gradeId").asText(),
                identity.policyVersion(), identity.roles(), member.get("entitlementSlotId").asText());
        ReleasedStockRecommendationSource source = new ReleasedStockRecommendationSource(SourceFixture.accounts(records, policy),
                records, new ReleasedStock(db.pool)::page, new StockFactsEvidence(), SourceFixture.clock());
        return new Composed(context, source, new RecommendationService(source, policy, SourceFixture.clock()));
    }

    static JsonNode evaluate(Path dir, String name, Path hr, JsonNode plan, JsonNode brief) throws Exception {
        PolicyService policy = SourceFixture.policy();
        try (Db db = Db.create()) {
            db.release(dir, name, plan, policy);
            return compose(hr, db, policy).recommend(brief);
        }
    }

    /** Each future invocation owns one schema; missing PostgreSQL fails instead of silently skipping this proof. */
    static final class Db implements AutoCloseable {
        private final PGSimpleDataSource admin;
        final PGSimpleDataSource pool;
        private final String schema;

        private Db(String url, String schema) throws SQLException {
            this.schema = schema;
            admin = dataSource(url);
            pool = dataSource(url);
            pool.setCurrentSchema(schema);
        }

        private static PGSimpleDataSource dataSource(String url) throws SQLException {
            PGSimpleDataSource source = new PGSimpleDataSource();
            source.setUrl(url);
            source.setConnectTimeout(5);
            source.setSocketTimeout(30);
            return source;
        }

        static Db create() throws Exception {
            String url = System.getenv("GCSP_TEST_DATABASE_URL");
            if (url == null || url.isBlank()) throw new IllegalStateException("GCSP_TEST_DATABASE_URL is required; this proof must not skip");
            Db db = new Db(url, "gcsp_shape_" + UUID.randomUUID().toString().replace("-", ""));
            try {
                Flyway.configure().dataSource(db.admin).schemas(db.schema).defaultSchema(db.schema).createSchemas(true)
                        .locations("classpath:db/migration").load().migrate();
                db.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", SourceFixture.ENV);
                db.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", SourceFixture.ENV, SourceFixture.RUN);
                return db;
            } catch (Exception error) {
                try {
                    db.close();
                } catch (SQLException cleanup) {
                    error.addSuppressed(cleanup);
                }
                throw error;
            }
        }

        void release(Path dir, String name, JsonNode plan, PolicyService policy) throws Exception {
            Path planFile = write(dir, name + "-plan", plan);
            Path policyFile = write(dir, name + "-policy", releasePolicy(policy));
            SupplySelection.Selected selected = SupplySelection.select(SupplySelection.TRANCHE_PLAN, planFile.toString(), policyFile.toString());
            assertEquals("tranche-plan", selected.provider().mode());
            assertEquals("file", selected.policyMode());
            ReleaseResult result = new StockRelease(pool, selected.policy(), selected.provider()).deliver(
                    new RunContext(SourceFixture.ENV, SourceFixture.RUN, "provider-shape-test"),
                    new TickEvent(name, Instant.parse(SourceFixture.NOW), 1));
            assertEquals(ReleaseResult.Status.OK, result.status(), () -> result.toString());
            assertEquals("stock-released", result.value().get("kind").asText());
            assertEquals(plan.get("windows").get(0).get("stock").size(), result.value().get("orderUuids").size());
        }

        private void update(String sql, String... values) throws SQLException {
            try (Connection connection = pool.getConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
                for (int i = 0; i < values.length; i++) statement.setString(i + 1, values[i]);
                statement.executeUpdate();
            }
        }

        @Override
        public void close() throws SQLException {
            try (Connection connection = admin.getConnection(); var statement = connection.createStatement()) {
                statement.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            }
        }
    }
}
