package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiFunction;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

/** Port of the pure project() in observed.js; each thrown Node Error becomes a LearningSourceException with its message as code. */
public final class ObservedLearningProjection {

    /** DECISION_EVENTS in server/gcsp/offers/decision.js. */
    public static final String DECISION_EVENTS = "offer-decisions:events:v1";
    public static final List<String> RECEIPT_CONSUMERS = List.of(DECISION_EVENTS, "buddy-expiry", "brief-selection:v1");

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private ObservedLearningProjection() {}

    /** Node inputDigest({ rows, clock, declineReasons }): the version of one complete read. */
    public static String projectionVersion(JsonNode rows, JsonNode clock, JsonNode declineReasons) {
        ObjectNode input = JSON.objectNode();
        input.set("rows", rows);
        input.set("clock", clock);
        input.set("declineReasons", declineReasons);
        return CanonicalJson.digest(input);
    }

    /** The demo clock value as the projection records it: a string or an integer version. */
    private static JsonNode clockNode(Object clockVersion) {
        if (clockVersion instanceof String s) return JSON.textNode(s);
        if (clockVersion instanceof Number n) {
            long v = n.longValue();
            return v == (int) v ? JSON.numberNode((int) v) : JSON.numberNode(v);
        }
        throw new IllegalArgumentException("clockVersion must be a string or an integer");
    }

    // ---- JavaScript value helpers ----

    private static boolean nullish(JsonNode v) {
        return v == null || v.isNull();
    }

    private static JsonNode nn(JsonNode a, Supplier<JsonNode> b) {
        return nullish(a) ? b.get() : a;
    }

    private static JsonNode g(JsonNode node, String key) {
        return Js.get(node, key);
    }

    /** A property read that throws, as Node does for a property of null or undefined. */
    private static JsonNode member(JsonNode node, String key) {
        if (nullish(node)) throw new LearningSourceException("source-invalid");
        return Js.get(node, key);
    }

    private static boolean eq(JsonNode a, JsonNode b) {
        return Js.strictEquals(a, b);
    }

    private static boolean eq(JsonNode a, String b) {
        return Js.isString(a, b);
    }

    /** SameValueZero identity of a JSON scalar, for Set and Map keys. */
    private static String key(JsonNode v) {
        if (v == null) return "undefined";
        if (v.isNull()) return "null";
        if (v.isTextual()) return "s" + v.textValue();
        if (v.isNumber()) return "n" + (v.doubleValue() == 0 ? 0.0 : v.doubleValue());
        return "o" + CanonicalJson.canonical(v);
    }

    /** JS template-literal text of a scalar id. */
    private static String text(JsonNode v) {
        if (v == null) return "undefined";
        if (v.isNull()) return "null";
        if (v.isTextual()) return v.textValue();
        return CanonicalJson.canonical(v);
    }

    private static String ref(String runId, String kind, JsonNode id) {
        if (nullish(id)) return null;
        ArrayNode input = JSON.arrayNode();
        input.add(runId).add(kind).add(id);
        return kind + ":" + CanonicalJson.digest(input);
    }

    private static JsonNode refNode(String value) {
        return value == null ? JSON.nullNode() : JSON.textNode(value);
    }

    private static boolean validInstant(JsonNode v) {
        return Js.isText(v) && Instants.valid(v.textValue());
    }

    private static boolean contains(JsonNode list, String value) {
        if (list == null) return false;
        if (list.isArray()) {
            for (JsonNode item : list) if (eq(item, value)) return true;
            return false;
        }
        return list.isTextual() && list.textValue().contains(value);
    }

    private static boolean safeVersion(JsonNode v) {
        return Js.safeInteger(v) && v.doubleValue() >= 1;
    }

    private static ObjectNode known(JsonNode value) {
        ObjectNode out = JSON.objectNode();
        out.put("status", "known");
        out.set("value", value);
        return out;
    }

    private static ObjectNode event(String state, List<JsonNode> times) {
        List<JsonNode> captured = new ArrayList<>();
        for (JsonNode at : times) if (!nullish(at)) captured.add(at);
        Set<Long> parsed = new HashSet<>();
        for (JsonNode at : captured) parsed.add(Js.isText(at) && Instants.valid(at.textValue()) ? Instants.parse(at.textValue()) : Long.MIN_VALUE);
        if ("unknown".equals(state) && !captured.isEmpty() || parsed.size() > 1) throw new LearningSourceException("contradictory-event-time");
        ObjectNode out = JSON.objectNode();
        out.put("state", state);
        out.set("at", captured.isEmpty() ? JSON.nullNode() : captured.get(0));
        return out;
    }

    private static List<JsonNode> list(JsonNode... values) {
        List<JsonNode> out = new ArrayList<>();
        for (JsonNode v : values) out.add(v);
        return out;
    }

    private static List<JsonNode> concat(List<JsonNode> first, List<JsonNode> second) {
        List<JsonNode> out = new ArrayList<>(first);
        out.addAll(second);
        return out;
    }

    private static List<JsonNode> rowsOf(JsonNode rows, String table) {
        List<JsonNode> out = new ArrayList<>();
        JsonNode array = g(rows, table);
        if (array != null && array.isArray()) array.forEach(out::add);
        return out;
    }

    private static JsonNode find(List<JsonNode> rows, Predicate<JsonNode> match) {
        for (JsonNode row : rows) if (match.test(row)) return row;
        return null;
    }

    private static boolean some(List<JsonNode> rows, Predicate<JsonNode> match) {
        return find(rows, match) != null;
    }

    private static boolean complete(JsonNode d) {
        JsonNode outcome = g(g(d, "outcome"), "status");
        JsonNode original = g(g(d, "originalResponse"), "status");
        return (outcome == null || eq(outcome, "ok")) && (original == null || eq(original, "ok"));
    }

    private static boolean pendingDecision(JsonNode d) {
        return eq(g(g(d, "outcome"), "status"), "pending") || eq(g(g(d, "originalResponse"), "status"), "pending");
    }

    private static double points(JsonNode v) {
        JsonNode value = g(v, "value");
        return eq(g(v, "unit"), "points") && Js.finite(value) ? value.doubleValue() : Double.NaN;
    }

    /** The projected learning records for one read, sorted by recordId. */
    public static ArrayNode project(JsonNode rows, String runId, String nowIso, Object clockVersion, List<String> declineCodes) {
        JsonNode clock = clockNode(clockVersion);
        List<JsonNode> briefs = new ArrayList<>();
        for (JsonNode b : rowsOf(rows, "briefs")) if (eq(g(b, "status"), "confirmed")) briefs.add(b);
        List<JsonNode> offers = rowsOf(rows, "offers");
        List<JsonNode> holds = rowsOf(rows, "holds");
        List<JsonNode> decisionRows = rowsOf(rows, "decisions");
        List<JsonNode> quotes = rowsOf(rows, "quotes");
        List<JsonNode> stock = rowsOf(rows, "stock");
        List<JsonNode> employees = rowsOf(rows, "employees");
        List<JsonNode> slots = rowsOf(rows, "entitlement_slots");
        List<JsonNode> receipts = rowsOf(rows, "receipts");

        Set<String> covered = new HashSet<>();
        record Entry(JsonNode offer, JsonNode quoteId, JsonNode brief) {}
        List<Entry> entries = new ArrayList<>();
        for (JsonNode offer : offers) {
            JsonNode quoteId = nn(g(offer, "quoteId"), () -> g(find(holds, h -> eq(g(h, "holdId"), g(offer, "holdId"))), "quoteId"));
            entries.add(new Entry(offer, quoteId, null));
        }
        Set<String> usedQuotes = new HashSet<>();
        for (Entry e : entries) usedQuotes.add(key(e.quoteId()));
        for (JsonNode quote : quotes) {
            if (!usedQuotes.contains(key(g(quote, "quoteId"))) && safeVersion(g(quote, "briefVersion"))) entries.add(new Entry(null, g(quote, "quoteId"), null));
        }
        if (some(decisionRows, d -> !some(offers, o -> eq(g(o, "offerId"), g(d, "offerId"))))) throw new LearningSourceException("orphan-decision");

        ArrayNode records = JSON.arrayNode();
        Consumer<Entry> append = entry -> {
            JsonNode offer = entry.offer();
            JsonNode quoteId = entry.quoteId();
            JsonNode unmatched = entry.brief();
            List<JsonNode> decisions = new ArrayList<>();
            for (JsonNode d : decisionRows) if (offer != null && eq(g(d, "offerId"), g(offer, "offerId"))) decisions.add(d);
            JsonNode quote = find(quotes, q -> eq(g(q, "quoteId"), quoteId));
            JsonNode employeeId = nn(g(offer, "employeeId"), () -> nn(g(quote, "employeeId"), () -> g(unmatched, "employeeId")));
            JsonNode employee = find(employees, e -> eq(g(e, "employeeId"), employeeId));
            if (!contains(g(employee, "roles"), "employee")) throw new LearningSourceException("missing-employee");
            List<JsonNode> matching = new ArrayList<>();
            for (JsonNode h : holds) {
                boolean match = offer != null ? eq(g(h, "holdId"), g(offer, "holdId")) : quote != null && eq(g(h, "quoteId"), g(quote, "quoteId"));
                if (match) matching.add(h);
            }
            if (matching.size() > 1) throw new LearningSourceException("ambiguous-hold");
            JsonNode hold = matching.isEmpty() ? null : matching.get(0);
            if (quote != null && !eq(g(quote, "employeeId"), employeeId) || hold != null && !eq(g(hold, "employeeId"), employeeId)
                    || some(decisions, d -> !eq(g(d, "employeeId"), employeeId))) throw new LearningSourceException("owner-mismatch");
            if (offer != null && hold != null && !eq(g(hold, "quoteId"), quoteId) || offer != null && quote != null && !eq(g(offer, "orderUuid"), g(quote, "orderUuid"))
                    || hold != null && quote != null && !eq(g(hold, "orderUuid"), g(quote, "orderUuid"))) throw new LearningSourceException("reference-mismatch");
            List<JsonNode> versions = new ArrayList<>();
            List<JsonNode> candidates = new ArrayList<>(list(g(offer, "briefVersion"), g(quote, "briefVersion")));
            for (JsonNode d : decisions) candidates.add(g(g(d, "versions"), "brief"));
            candidates.add(g(unmatched, "briefVersion"));
            for (JsonNode v : candidates) if (!nullish(v)) versions.add(v);
            if (versions.isEmpty()) throw new LearningSourceException("brief-version-mismatch");
            for (JsonNode v : versions) if (!safeVersion(v) || !eq(v, versions.get(0))) throw new LearningSourceException("brief-version-mismatch");
            JsonNode brief = find(briefs, b -> eq(g(b, "employeeId"), employeeId) && eq(g(b, "briefVersion"), versions.get(0)));
            if (brief == null) throw new LearningSourceException("missing-confirmed-brief");
            covered.add(text(employeeId) + ":" + text(g(brief, "briefVersion")));
            List<JsonNode> slotIds = new ArrayList<>();
            for (JsonNode v : list(g(brief, "entitlementSlotId"), g(hold, "entitlementSlotId"), g(quote, "entitlementSlotId"))) if (!nullish(v)) slotIds.add(v);
            List<JsonNode> renewals = new ArrayList<>();
            for (JsonNode v : list(g(brief, "renewalId"), g(hold, "renewalId"))) if (!nullish(v)) renewals.add(v);
            if (distinct(slotIds) > 1 || distinct(renewals) > 1) throw new LearningSourceException("entitlement-reference-mismatch");
            JsonNode slotId = slotIds.isEmpty() ? null : slotIds.get(0);
            JsonNode slot = find(slots, s -> eq(g(s, "entitlementSlotId"), slotId));
            if (slot != null && !eq(g(slot, "employeeId"), employeeId)) throw new LearningSourceException("slot-owner-mismatch");
            JsonNode renewalId = renewals.isEmpty() ? null : renewals.get(0);
            JsonNode orderUuid = nn(g(offer, "orderUuid"), () -> nn(g(quote, "orderUuid"), () -> g(hold, "orderUuid")));
            boolean selected = eq(g(offer, "state"), "selected")
                    || some(decisions, d -> (eq(g(d, "decision"), "select") || eq(g(d, "decision"), "selected")) && complete(d))
                    || eq(g(hold, "state"), "allocated")
                            && some(stock, s -> eq(g(s, "orderUuid"), orderUuid) && (eq(g(s, "state"), "allocated") || Js.isTrue(g(s, "allocated"))));
            boolean accepted = eq(g(offer, "state"), "accepted") || some(decisions, d -> eq(g(d, "decision"), "accept") && complete(d));
            boolean declined = eq(g(offer, "state"), "rejected") || eq(g(offer, "state"), "declined")
                    || some(decisions, d -> eq(g(d, "decision"), "decline") && complete(d));
            boolean expired = eq(g(offer, "state"), "expired");
            if (declined && (accepted || selected || expired) || expired && (accepted || selected)) throw new LearningSourceException("contradictory-outcomes");
            JsonNode decline = find(decisions, d -> eq(g(d, "decision"), "decline") && complete(d));
            JsonNode declineType = g(g(decline, "reason"), "code");
            boolean pending = eq(g(offer, "state"), "decision-pending") || eq(g(offer, "state"), "selection-pending")
                    || eq(g(hold, "state"), "selection-pending") || some(decisions, d -> eq(g(d, "decision"), "accept") && pendingDecision(d));
            if (pending && (accepted || selected || declined || expired)) throw new LearningSourceException("contradictory-pending");
            Function<JsonNode, JsonNode> decidedAt = d -> nn(g(d, "decidedAt"), () -> {
                JsonNode r = find(receipts, x -> receiptMatch(x, DECISION_EVENTS,
                        y -> eq(g(g(g(g(y, "outcome"), "value"), "event"), "decisionId"), g(d, "decisionId"))));
                return r == null ? null : member(member(member(g(r, "outcome"), "value"), "event"), "occurredAt");
            });
            BiFunction<List<String>, Predicate<JsonNode>, List<JsonNode>> decisionTimes = (values, isComplete) -> {
                List<JsonNode> out = new ArrayList<>();
                for (JsonNode d : decisions) if (values.contains(textOrNull(g(d, "decision"))) && isComplete.test(d)) out.add(decidedAt.apply(d));
                return out;
            };
            JsonNode picked = offer == null ? null : receiptField(receipts, "brief-selection:v1", offer, "selectedAt");
            JsonNode expiredAt = nn(g(offer, "expiredAt"), () -> offer == null ? null : receiptField(receipts, "buddy-expiry", offer, "expiredAt"));
            JsonNode offeredAt = nn(g(offer, "offeredAt"), () -> offer != null && quote != null && !Js.truthy(g(hold, "operationId")) ? g(quote, "quotedAt") : null);
            List<JsonNode> checked = list(offeredAt, g(offer, "acceptedAt"), g(offer, "rejectedAt"), g(offer, "declinedAt"), expiredAt,
                    g(offer, "selectedAt"), g(offer, "pendingAt"), g(hold, "selectedAt"), g(hold, "pendingAt"), g(quote, "quotedAt"), picked);
            for (JsonNode d : decisions) checked.add(decidedAt.apply(d));
            validateTimes(nowIso, checked);
            List<JsonNode> pendingTimes = pending
                    ? concat(list(g(offer, "pendingAt"), g(hold, "pendingAt")), decisionTimes.apply(List.of("accept"), ObservedLearningProjection::pendingDecision))
                    : new ArrayList<>();
            ObjectNode outcomes = JSON.objectNode();
            outcomes.set("offered", event(offer != null ? "offered" : "unknown", list(offeredAt)));
            outcomes.set("selection", event(selected ? "selected" : pending ? "pending" : "unknown", concat(concat(
                    list(g(offer, "selectedAt"), g(hold, "selectedAt"), picked), decisionTimes.apply(List.of("select", "selected"), ObservedLearningProjection::complete)), pendingTimes)));
            outcomes.set("acceptance", event(accepted ? "accepted" : pending ? "pending" : "unknown", concat(concat(
                    list(g(offer, "acceptedAt")), decisionTimes.apply(List.of("accept"), ObservedLearningProjection::complete)), pendingTimes)));
            ObjectNode declineEvent = event(declined ? "declined" : "unknown", concat(list(g(offer, "rejectedAt"), g(offer, "declinedAt")),
                    decisionTimes.apply(List.of("decline"), ObservedLearningProjection::complete)));
            if (declined) declineEvent.put("reasonType", Js.isText(declineType) && declineCodes.contains(declineType.textValue()) ? declineType.textValue() : "unclassified");
            else declineEvent.putNull("reasonType");
            outcomes.set("decline", declineEvent);
            outcomes.set("expiry", event(expired ? "expired" : "unknown", list(expiredAt)));
            ObjectNode wait = event("unknown", List.of());
            wait.putNull("reasonType");
            outcomes.set("wait", wait);
            outcomes.set("satisfaction", event("unknown", List.of()));
            JsonNode offered = outcomes.get("offered").get("at");
            if (!offered.isNull()) {
                long offeredMs = Instants.parse(offered.textValue());
                var it = outcomes.fields();
                while (it.hasNext()) {
                    var e = it.next();
                    JsonNode at = e.getValue().get("at");
                    if (!e.getKey().equals("offered") && !at.isNull() && Instants.parse(at.textValue()) < offeredMs) throw new LearningSourceException("event-before-offer");
                }
            }
            JsonNode terms = LearningRecords.unknown(quote != null ? "not-captured" : "missing-quote");
            // Only the dated saved quote can establish historical terms; repository createdAt never substitutes.
            double monthly = points(g(quote, "monthlyPoints"));
            double allowance = points(g(g(quote, "allowance"), "allowance"));
            JsonNode validUntil = nn(g(quote, "validUntil"), () -> g(quote, "expiresAt"));
            if (quote != null && Double.isFinite(monthly) && Double.isFinite(allowance) && validInstant(g(quote, "quotedAt")) && validInstant(validUntil)
                    && Js.isText(g(quote, "configurationId")) && Js.isText(g(quote, "policyVersion"))) {
                ObjectNode value = JSON.objectNode();
                value.put("quoteRef", ref(runId, "quote", g(quote, "quoteId")));
                value.set("configurationId", g(quote, "configurationId"));
                value.set("monthlyPoints", g(g(quote, "monthlyPoints"), "value"));
                value.set("allowance", g(g(g(quote, "allowance"), "allowance"), "value"));
                value.put("unit", "points/month");
                value.set("quotedAt", g(quote, "quotedAt"));
                value.set("validUntil", validUntil);
                value.set("policyVersion", g(quote, "policyVersion"));
                terms = known(value);
            }
            ObjectNode record = JSON.objectNode();
            record.put("schemaVersion", 1);
            record.put("recordId", ref(runId, "record", offer != null ? recordKey("offer", g(offer, "offerId"))
                    : quote != null ? recordKey("quote", g(quote, "quoteId")) : recordKey("brief", employeeId, g(brief, "briefVersion"))));
            record.put("runId", runId);
            ObjectNode subject = record.putObject("subject");
            subject.set("employeeRef", refNode(ref(runId, "employee", employeeId)));
            subject.set("entitlementSlotRef", refNode(ref(runId, "slot", slotId)));
            subject.set("renewalRef", refNode(ref(runId, "renewal", renewalId)));
            ObjectNode target = record.putObject("target");
            target.set("offerRef", refNode(ref(runId, "offer", g(offer, "offerId"))));
            target.set("holdRef", refNode(ref(runId, "hold", g(hold, "holdId"))));
            target.set("quoteRef", refNode(ref(runId, "quote", quoteId)));
            target.set("orderRef", refNode(ref(runId, "order", orderUuid)));
            target.set("configurationId", Js.truthy(g(quote, "configurationId")) ? known(g(quote, "configurationId")) : LearningRecords.unknown("not-captured"));
            ObjectNode renewal = record.putObject("renewal");
            renewal.set("cohort", LearningRecords.unknown("not-captured"));
            renewal.set("period", LearningRecords.unknown("not-captured"));
            ObjectNode entitlement = record.putObject("entitlement");
            entitlement.set("schemeId", LearningRecords.unknown("missing-context"));
            entitlement.set("gradeId", LearningRecords.unknown("missing-context"));
            entitlement.set("allowanceBand", LearningRecords.unknown("not-captured"));
            ObjectNode briefOut = record.putObject("brief");
            for (String field : List.of("briefVersion", "policyVersion", "confirmedAt")) if (g(brief, field) != null) briefOut.set(field, g(brief, field));
            ObjectNode intent = LearningRecords.projectBriefIntent(brief);
            briefOut.set("preferences", intent.get("preferences"));
            briefOut.set("essentials", intent.get("essentials"));
            record.set("choiceSet", LearningRecords.unknown("not-captured"));
            record.set("terms", terms);
            record.set("outcomes", outcomes);
            ObjectNode timestamps = record.putObject("timestamps");
            timestamps.put("projectedAt", nowIso);
            timestamps.set("clockVersion", clock);
            record.putObject("provenance").put("kind", "observed");
            LearningRecords.Validation validated = LearningRecords.validate(record, declineCodes);
            if (!validated.isOk()) throw new LearningSourceException("invalid-record");
            records.add(validated.value());
        };
        entries.forEach(append);
        // The latest confirmed brief of each employee that no offer or quote covered becomes its own record.
        Map<String, JsonNode> latest = new LinkedHashMap<>();
        for (JsonNode b : briefs) {
            String id = key(g(b, "employeeId"));
            JsonNode current = latest.get(id);
            if (current == null || Js.toNumber(g(current, "briefVersion")) < Js.toNumber(g(b, "briefVersion"))) latest.put(id, b);
        }
        for (JsonNode brief : latest.values()) {
            if (!covered.contains(text(g(brief, "employeeId")) + ":" + text(g(brief, "briefVersion")))) append.accept(new Entry(null, null, brief));
        }
        List<JsonNode> sorted = new ArrayList<>();
        records.forEach(sorted::add);
        sorted.sort((a, b) -> a.get("recordId").textValue().compareTo(b.get("recordId").textValue()));
        ArrayNode out = JSON.arrayNode();
        sorted.forEach(out::add);
        return out;
    }

    private static JsonNode recordKey(String kind, JsonNode... ids) {
        ArrayNode out = JSON.arrayNode();
        out.add(kind);
        for (JsonNode id : ids) out.add(id == null ? JSON.nullNode() : id);
        return out;
    }

    private static String textOrNull(JsonNode v) {
        return v != null && v.isTextual() ? v.textValue() : null;
    }

    private static long distinct(List<JsonNode> values) {
        Set<String> keys = new HashSet<>();
        for (JsonNode v : values) keys.add(key(v));
        return keys.size();
    }

    private static boolean receiptMatch(JsonNode receipt, String consumerId, Predicate<JsonNode> match) {
        return eq(g(receipt, "consumerId"), consumerId) && eq(g(g(receipt, "outcome"), "status"), "ok") && match.test(receipt);
    }

    /** receipt(consumer, offerId match)?.outcome.value[field]. */
    private static JsonNode receiptField(List<JsonNode> receipts, String consumerId, JsonNode offer, String field) {
        JsonNode r = find(receipts, x -> receiptMatch(x, consumerId, y -> eq(g(g(g(y, "outcome"), "value"), "offerId"), g(offer, "offerId"))));
        return r == null ? null : member(member(g(r, "outcome"), "value"), field);
    }

    private static void validateTimes(String asOf, List<JsonNode> times) {
        for (JsonNode at : times) {
            if (nullish(at)) continue;
            if (!validInstant(at) || Instants.parse(at.textValue()) > Instants.parse(asOf)) throw new LearningSourceException("invalid-event-time");
        }
    }
}
