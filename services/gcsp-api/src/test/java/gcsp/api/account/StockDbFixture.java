package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.EnvironmentGuard;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import gcsp.api.recommendation.AccountClockRecommendationClock;
import gcsp.api.recommendation.StockFactsEvidence;
import gcsp.api.supply.ReleasedStock;
import java.io.IOException;
import java.io.InputStream;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;

/**
 * Paula over a fresh migrated schema with released stock and a saved complete draft, for the manual stock tests in this
 * package and in claims. Cars 1 and 6 come out eligible; see rows().
 */
public final class StockDbFixture implements AutoCloseable {

    static final ObjectMapper JSON = new ObjectMapper();
    public static final String UUID_PREFIX = "00000000-0000-4000-8000-00000000000";

    private final RepositoryFixture db;
    private final GoldenFixture fx;
    private final ManualDrafts drafts;
    private final ManualStock stock;

    private StockDbFixture(RepositoryFixture db, GoldenFixture fx) throws SQLException {
        this.db = db;
        this.fx = fx;
        AccountService accounts = fx.service(db.records());
        TransactionRunner runner = new TransactionRunner(db.pool());
        this.drafts = new ManualDrafts(accounts, db.pool(), runner);
        PolicyService policy = new PolicyService(new RetainedFilePolicySource());
        EnvironmentGuard.RunState run = new EnvironmentGuard.RunState(fx.scope.environmentId(), fx.scope.runId(), 1);
        this.stock = new ManualStock(accounts, drafts, policy, new ReleasedStock(db.pool())::page, new StockFactsEvidence(),
                new AccountClockRecommendationClock(s -> fx.clock.now(s), () -> run));
    }

    /** Skips when GCSP_TEST_DATABASE_URL is unset. */
    public static StockDbFixture create() throws Exception {
        RepositoryFixture db = RepositoryFixture.create();
        GoldenFixture fx = new GoldenFixture("paula");
        db.claim(fx);
        db.seed(fx);
        GoldenFixture jordan = new GoldenFixture("jordan");
        try (Connection c = db.pool().getConnection()) {
            RepositoryFixture.seed(c, jordan, jordan.scope.environmentId(), jordan.scope.runId());
        }
        StockDbFixture f = new StockDbFixture(db, fx);
        try (Connection c = db.pool().getConnection()) {
            insertStock(c, fx.scope.environmentId(), fx.scope.runId(), rows());
        }
        return f;
    }

    public ManualStock stock() {
        return stock;
    }

    public DataSource pool() throws SQLException {
        return db.pool();
    }

    public AccountScope identity() {
        return new AccountScope(fx.scope.environmentId(), fx.scope.runId(), fx.scope.employeeId(), null, fx.scope.roles(),
                null, null, null, null, fx.scope.policyVersion());
    }

    public String environmentId() {
        return fx.scope.environmentId();
    }

    public String runId() {
        return fx.scope.runId();
    }

    public String employeeId() {
        return fx.scope.employeeId();
    }

    public String policyVersion() {
        return fx.scope.policyVersion();
    }

    /** The account's current context version, which a draft is saved against. */
    public String contextVersion() {
        return fx.service(wrap()).readAccount(identity()).value().get("contextVersion").asText();
    }

    private AccountRecordsPort wrap() {
        try {
            return db.records();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Saves the choices as the next draft (expecting the given draft version) and returns the stored draft. */
    public JsonNode saveDraft(String commandId, long expectedDraft, JsonNode choices) {
        ObjectNode in = JSON.createObjectNode().put("commandId", commandId).put("expectedDraftVersion", expectedDraft)
                .put("expectedContextVersion", contextVersion());
        in.set("choices", choices);
        AccountOutcome out = drafts.save(identity(), "sub-paula", in);
        if (!out.isOk()) throw new IllegalStateException(String.valueOf(out.refusal()));
        return out.value();
    }

    public void update(String sql, Object... params) throws SQLException {
        db.update(sql, params);
    }

    /** The complete draft choices of ManualDraftRulesTest.complete(), usable from other packages. */
    public static ObjectNode complete() {
        return ManualDraftRulesTest.complete();
    }

    /** The intent-only draft choices. */
    public static ObjectNode intent() {
        return ManualDraftRulesTest.intent();
    }

    /**
     * Node's paula-mixed cars 1 to 6 with insurance groups (car 6 is exactly at her grade limit of 35), plus car 7 over
     * the limit (40) and car 8 with no insurance fact. Car 2 is a policy exclusion; 4 and 5 are not visible to Paula.
     */
    public static List<JsonNode> rows() throws IOException {
        JsonNode source;
        try (InputStream in = StockDbFixture.class.getResourceAsStream("/recommendation-source/source-cases.json")) {
            source = JSON.readTree(in).get("cases").get(0).get("rows");
        }
        List<JsonNode> rows = new ArrayList<>();
        int[] groups = {20, 20, 20, 20, 20, 35};
        for (int i = 0; i < source.size(); i++) {
            ObjectNode row = ((ObjectNode) source.get(i)).deepCopy();
            insurance(row, groups[i]);
            rows.add(row);
        }
        rows.add(copyOf(source.get(0), "7", 40));
        rows.add(copyOf(source.get(0), "8", -1));
        return rows;
    }

    private static ObjectNode copyOf(JsonNode base, String digit, int group) {
        ObjectNode row = ((ObjectNode) base).deepCopy();
        String id = UUID_PREFIX + digit;
        row.put("orderUuid", id).put("orderNumber", "100000" + digit);
        ((ObjectNode) row.get("facts").get("sourceKeys")).put("stockId", id);
        if (group >= 0) insurance(row, group);
        return row;
    }

    private static void insurance(ObjectNode row, int group) {
        ObjectNode fact = JSON.createObjectNode().put("status", "known").put("value", group).put("unit", "insurance-group");
        fact.set("provenance", row.get("facts").get("facts").get("body").get("provenance"));
        ((ObjectNode) row.get("facts").get("facts")).set("insuranceGroup", fact);
    }

    /** Inserts released cars as the Node rows: attributes are everything but the typed columns. */
    public static void insertStock(Connection c, String env, String run, List<JsonNode> rows) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO stock_cars (environment_id, run_id, order_uuid, "
                + "configuration_id, state, attributes, version) VALUES (?, ?, ?, ?, 'released', ?::jsonb, ?)")) {
            for (JsonNode row : rows) {
                ObjectNode attributes = ((ObjectNode) row).deepCopy();
                attributes.remove(List.of("orderUuid", "configurationId", "state", "available", "held", "allocated", "version"));
                ps.setString(1, env);
                ps.setString(2, run);
                ps.setString(3, row.get("orderUuid").asText());
                ps.setString(4, row.get("configurationId").asText());
                ps.setString(5, attributes.toString());
                ps.setLong(6, row.get("version").asLong());
                ps.addBatch();
            }
            ps.executeBatch();
        }
    }

    /** An active cart hold of the slot's employee on a car, so the car is occupied for everyone else. */
    public void hold(String holdId, String orderUuid, String employeeId, String slotId, String type) throws SQLException {
        db.update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'active', now() + interval '1 day')",
                environmentId(), runId(), holdId, orderUuid, employeeId, slotId, type);
    }

    @Override
    public void close() throws SQLException {
        db.close();
    }
}
