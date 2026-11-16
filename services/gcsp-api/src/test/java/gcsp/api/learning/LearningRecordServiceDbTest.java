package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.brief.BriefResult;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.brief.BriefScope;
import gcsp.api.brief.BriefService;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BiConsumer;
import org.junit.jupiter.api.Test;

/** readRecords over a native PostgreSQL schema; skipped when GCSP_TEST_DATABASE_URL is unset. */
class LearningRecordServiceDbTest {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final LearningOutcomeRows UNBOUND = new UnboundLearningOutcomeRows();
    private static final JsonNode CASES = LearningFixtures.read(Path.of("src/test/resources/learning-parity/records-cases.json"));

    private static JsonNode ok(BriefResult r) {
        return ((BriefResult.Ok) r).value();
    }

    private static ObjectNode envelope(String id, long brief, long draft) {
        return JSON.objectNode().put("commandId", id).put("expectedBriefVersion", brief).put("expectedDraftVersion", draft);
    }

    private static void choose(ObjectNode brief, String key, JsonNode value, int importance) {
        ObjectNode p = JSON.objectNode();
        p.set("value", value);
        p.put("importance", importance).put("valueState", "draft").put("importanceState", "draft").put("source", "employee");
        ((ObjectNode) brief.get("preferences")).set(key, p);
    }

    /** Saves a draft of three considered categories (the comfort slider varies the version) and confirms it. */
    private static void confirmVersion(BriefService briefs, BriefScope scope, long version, int comfort) {
        ObjectNode content = ((ObjectNode) ok(briefs.resolveInitial(scope)).get("initial")).deepCopy();
        content.set("preferences", JSON.objectNode());
        choose(content, "body", JSON.arrayNode().add("saloon").add("estate"), 50);
        choose(content, "sportiness", JSON.numberNode(50), 50);
        choose(content, "comfort", JSON.numberNode(comfort), 50);
        ok(briefs.saveDraft(scope, envelope("draft-" + version, version - 1, version - 1).set("brief", content)));
        ok(briefs.confirm(scope, envelope("confirm-" + version, version - 1, version)));
    }

    @Test
    void producerProofKeepsTheProvenanceOfTheRealBriefWriter() throws Exception {
        try (LearningDb db = LearningDb.create()) {
            BriefService briefs = db.briefService();
            BriefScope scope = LearningDb.scope("emp-1");
            confirmVersion(briefs, scope, 1, 40);
            confirmVersion(briefs, scope, 2, 60);
            JsonNode saved = ok(briefs.current(scope)).get("brief");
            assertEquals(2, saved.get("briefVersion").intValue());
            List<Long> before = db.snapshot();

            LearningRecordResult out = LearningDb.service(db.counting(), LearningDb.policy(LearningDb.reviewedReasons()), UNBOUND)
                    .readRecords(LearningDb.greg());
            assertTrue(out.ok(), out.body().toString());
            JsonNode value = out.value();
            assertEquals(LearningDb.RUN, value.get("runId").textValue());
            assertEquals(LearningDb.NOW, value.get("asOf").textValue());
            assertEquals(64, value.get("projectionVersion").textValue().length());
            assertEquals("unknown", value.get("outcomeSources").get("status").textValue());
            assertEquals("outcome-producers-not-bound", value.get("outcomeSources").get("reason").textValue());
            assertEquals(1, value.get("records").size());

            JsonNode record = value.get("records").get(0);
            assertEquals("observed", record.get("provenance").get("kind").textValue());
            assertEquals(2, record.get("brief").get("briefVersion").intValue());
            assertEquals(saved.get("policyVersion").textValue(), record.get("brief").get("policyVersion").textValue());
            assertEquals(Instant.parse(saved.get("confirmedAt").textValue()), Instant.parse(record.get("brief").get("confirmedAt").textValue()));
            assertEquals(60, record.get("brief").get("preferences").get("comfort").get("value").intValue());
            assertEquals("unknown", record.get("choiceSet").get("status").textValue());
            assertEquals("unknown", record.get("terms").get("status").textValue());
            assertEquals("missing-quote", record.get("terms").get("reason").textValue());
            for (String key : List.of("offered", "selection", "acceptance", "decline", "expiry", "wait", "satisfaction")) {
                JsonNode outcome = record.get("outcomes").get(key);
                assertEquals("unknown", outcome.get("state").textValue(), key);
                assertTrue(outcome.get("at").isNull(), key);
            }
            assertTrue(record.get("target").get("offerRef").isNull());
            assertTrue(record.get("subject").get("entitlementSlotRef").isNull());
            assertTrue(record.get("subject").get("renewalRef").isNull());
            assertTrue(LearningRecords.validate(record, List.of("body-style", "size", "fuel", "equipment")).isOk());
            assertEquals(before, db.snapshot());
        }
    }

    private static ObjectNode content(JsonNode brief) {
        ObjectNode content = JSON.objectNode();
        content.set("preferences", brief.get("preferences"));
        content.set("essentials", brief.get("essentials"));
        return content;
    }

    private static List<String> codes() {
        List<String> out = new ArrayList<>();
        LearningDb.reviewedReasons().get("reasons").forEach(r -> out.add(r.get("code").textValue()));
        return out;
    }

    private static JsonNode apply(JsonNode base, JsonNode ops) {
        JsonNode root = base.deepCopy();
        for (JsonNode op : ops) {
            String[] parts = op.get(0).textValue().substring(1).split("/");
            JsonNode at = root;
            for (int i = 0; i < parts.length - 1; i++) at = at.isArray() ? at.get(Integer.parseInt(parts[i])) : at.get(parts[i]);
            String last = parts[parts.length - 1];
            if (op.size() == 1) ((ObjectNode) at).remove(last);
            else if (at.isArray()) {
                ArrayNode array = (ArrayNode) at;
                int index = Integer.parseInt(last);
                if (index == array.size()) array.add(op.get(1).deepCopy());
                else array.set(index, op.get(1).deepCopy());
            } else ((ObjectNode) at).set(last, op.get(1).deepCopy());
        }
        return root;
    }

    private static boolean outcomeOnly(JsonNode c) {
        for (JsonNode op : c.get("rowOps")) {
            String table = op.get(0).textValue().split("/")[1];
            if (!List.of("offers", "holds", "decisions", "quotes", "receipts").contains(table)) return false;
        }
        return c.get("rowBase").textValue().equals("offer");
    }

    private static List<JsonNode> list(JsonNode rows, String table) {
        List<JsonNode> out = new ArrayList<>();
        rows.get(table).forEach(out::add);
        return out;
    }

    @Test
    void aBoundOutcomePortGivesTheSameRecordsAsTheProjectionOnTheSameRows() throws Exception {
        try (LearningDb db = LearningDb.create()) {
            db.update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, 'emp-1')", LearningDb.ENV, LearningDb.RUN);
            db.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, 'slot-emp-1', 'emp-1', 1)",
                    LearningDb.ENV, LearningDb.RUN);
            db.update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                    + "VALUES (?, ?, '00000000-0000-4000-8000-000000000001', 'RzIxOlMx', 'released')", LearningDb.ENV, LearningDb.RUN);
            db.update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, 'emp-1', 1)", LearningDb.ENV, LearningDb.RUN);
            JsonNode base = CASES.get("rowBases").get("offer");
            JsonNode brief = base.get("briefs").get(0);
            db.update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, operation, content, buddy, semantic_digest, "
                    + "policy_version, confirmed_by, confirmed_at, command_id) VALUES (?, ?, 'emp-1', 1, 'confirmed', ?::jsonb, '{}'::jsonb, "
                    + "repeat('a', 64), ?, 'p', ?::timestamptz, 'c1')", LearningDb.ENV, LearningDb.RUN,
                    content(brief).toString(),
                    brief.get("policyVersion").textValue(), brief.get("confirmedAt").textValue());
            LearningRecordService[] holder = new LearningRecordService[1];
            LearningOutcomeRows[] bound = new LearningOutcomeRows[1];
            int[] checked = {0, 0};
            BiConsumer<JsonNode, JsonNode> check = (c, rows) -> {
                JsonNode clock = c.get("clock");
                ObjectNode mapped = (ObjectNode) rows.deepCopy();
                ((ObjectNode) mapped.get("briefs").get(0)).remove(List.of("entitlementSlotId", "renewalId"));
                java.util.Set<String> named = new java.util.HashSet<>();
                for (String t : List.of("offers", "holds", "quotes")) rows.get(t).forEach(r -> { if (r.hasNonNull("orderUuid")) named.add(r.get("orderUuid").textValue()); });
                ArrayNode stock = JSON.arrayNode();
                if (named.contains("00000000-0000-4000-8000-000000000001")) {
                    stock.addObject().put("runId", "run-1").put("orderUuid", "00000000-0000-4000-8000-000000000001")
                            .put("configurationId", "RzIxOlMx").put("state", "released");
                }
                mapped.set("stock", stock);
                bound[0] = new LearningOutcomeRows() {
                    public boolean bound() {
                        return true;
                    }

                    public Rows read(java.sql.Connection snapshot, String env, String run) {
                        return new Rows(list(rows, "offers"), list(rows, "holds"), list(rows, "decisions"), list(rows, "quotes"), list(rows, "receipts"));
                    }
                };
                LearningClock.Reading reading = new LearningClock.Reading(clock.get("now").textValue(),
                        clock.get("clockVersion").isTextual() ? clock.get("clockVersion").textValue() : (Object) clock.get("clockVersion").longValue());
                try {
                    holder[0] = LearningDb.service(db.pool(), LearningDb.policy(LearningDb.reviewedReasons()), reading, bound[0]);
                } catch (java.sql.SQLException e) {
                    throw new IllegalStateException(e);
                }
                LearningRecordResult out = holder[0].readRecords(LearningDb.greg());
                String name = c.get("name").textValue();
                ArrayNode expected = null;
                try {
                    expected = ObservedLearningProjection.project(mapped, "run-1", reading.now(), reading.clockVersion(), codes());
                } catch (LearningSourceException e) {
                    assertEquals("source-invalid", out.code(), name);
                    checked[1]++;
                    return;
                }
                assertTrue(out.ok(), name + " " + out.body());
                assertEquals(CanonicalJson.canonical(expected), CanonicalJson.canonical(out.value().get("records")), name);
                ObjectNode clockValue = JSON.objectNode().put("runId", "run-1").put("now", reading.now());
                if (reading.clockVersion() instanceof String s) clockValue.put("clockVersion", s);
                else clockValue.put("clockVersion", ((Number) reading.clockVersion()).longValue());
                assertEquals(ObservedLearningProjection.projectionVersion(mapped, clockValue, LearningDb.reviewedReasons()),
                        out.value().get("projectionVersion").textValue(), name);
                assertEquals("known", out.value().get("outcomeSources").get("status").textValue(), name);
                for (JsonNode r : out.value().get("records")) assertTrue(LearningRecords.validate(r, codes()).isOk(), name);
                checked[0]++;
            };
            for (JsonNode c : CASES.get("cases")) {
                if (c.get("kind").textValue().equals("validate") || !outcomeOnly(c)) continue;
                // The registry is the reviewed one; cases built on a different registry are not comparable here.
                if (!c.get("declineReasons").equals(LearningDb.reviewedReasons())) continue;
                check.accept(c, apply(base, c.get("rowOps")));
            }
            System.out.println("bound-outcome parity: " + checked[0] + " projected, " + checked[1] + " failed as source-invalid");
            assertTrue(checked[0] >= 25, "projected cases " + checked[0]);
            assertTrue(checked[1] >= 1);
        }
    }

    @Test
    void aRetiredRunConflictsAndAnEmployeeIsForbidden() throws Exception {
        try (LearningDb db = LearningDb.create()) {
            db.insertBriefs(3, "2026-11-13T09:00:00Z");
            LearningRecordService service = LearningDb.service(db.pool(), LearningDb.policy(LearningDb.reviewedReasons()), UNBOUND);
            LearningRecordResult forbidden = service.readRecords(LearningDb.employee());
            assertEquals("forbidden", forbidden.status());
            assertEquals(3, service.readRecords(LearningDb.greg()).value().get("records").size());
            db.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE environment_id = ? AND run_id = ?", LearningDb.ENV, LearningDb.RUN);
            LearningRecordResult retired = service.readRecords(LearningDb.greg());
            assertEquals("conflict", retired.status());
            assertEquals("stale-run", retired.code());
            assertFalse(retired.body().has("value"));
        }
    }

    @Test
    void readingChangesNothing() throws Exception {
        try (LearningDb db = LearningDb.create()) {
            db.insertBriefs(5, "2026-11-13T09:00:00Z");
            List<Long> before = db.snapshot();
            LearningRecordService service = LearningDb.service(db.pool(), LearningDb.policy(LearningDb.reviewedReasons()), UNBOUND);
            LearningRecordResult first = service.readRecords(LearningDb.greg());
            LearningRecordResult second = service.readRecords(LearningDb.greg());
            assertEquals(first.value(), second.value());
            assertEquals(before, db.snapshot());
            assertEquals(0, db.count("SELECT count(*) FROM command_receipts") + db.count("SELECT count(*) FROM outbox_events"));
        }
    }

    @Test
    void theStatementCountIsFixedAndTwoThousandBriefsReadQuickly() throws Exception {
        try (LearningDb db = LearningDb.create()) {
            var policy = LearningDb.policy(LearningDb.reviewedReasons());
            var counting = db.counting();
            LearningRecordService service = LearningDb.service(counting, policy, UNBOUND);
            assertTrue(service.readRecords(LearningDb.greg()).ok());
            int perCall = db.statements.getAndSet(0);

            db.insertBriefs(2000, "2026-11-13T09:00:00Z");
            long start = System.nanoTime();
            LearningRecordResult out = service.readRecords(LearningDb.greg());
            long millis = (System.nanoTime() - start) / 1_000_000;
            assertTrue(out.ok(), out.body().toString());
            assertEquals(2000, out.value().get("records").size());
            int statements = db.statements.get();
            System.out.println("2000 briefs: " + millis + " ms, " + statements + " statements (empty run: " + perCall + ")");
            assertEquals(perCall, statements);
            assertEquals(4, statements);
        }
    }
}
