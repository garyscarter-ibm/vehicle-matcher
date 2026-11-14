package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountClockPort.ClockReading;
import gcsp.api.account.AccountPolicyPort.PolicyOutcome;
import gcsp.api.account.AccountPolicyPort.PolicyRead;
import gcsp.api.persistence.Canonical;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Turns account facts from replaceable ports into the account projection, matching Node's
 * ManualContextService.readAccount. Ports supply facts; every decision is made here.
 */
public final class AccountService {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final List<String> SOURCE_MODES = List.of("synthetic", "dated-snapshot", "authorised-live");
    private static final Set<String> UNKNOWN_CODES = Set.of("unknown-scheme", "unknown-company", "unknown-grade");

    private final AccountRecordsPort records;
    private final AccountPolicyPort policy;
    private final AccountClockPort clock;
    private final CurrentCarPort cars;

    public AccountService(AccountRecordsPort records, AccountPolicyPort policy, AccountClockPort clock,
            CurrentCarPort cars) {
        this.records = records;
        this.policy = policy;
        this.clock = clock;
        this.cars = cars;
    }

    /** Prepared facts and decisions; account is null for the absent-hr-account state. */
    private static final class Prepared {
        AccountScope scope;
        String now;
        String clockVersion;
        String state;
        JsonNode account;
        JsonNode drivers;
        Map<String, String> schemeNames = Map.of();
        JsonNode rules;
        JsonNode configuration;
        JsonNode allowance;
        JsonNode slot;
        JsonNode contract;
        String contextVersion;
        AccountOutcome error;
    }

    public AccountOutcome readAccount(AccountScope scope) {
        Prepared p = prepare(scope);
        if (p.error != null) return p.error;
        if (p.account == null) return AccountOutcome.ok(projection(p, F.arrayNode()));
        JsonNode relationships;
        try {
            SourceResult found = cars.list(p.scope);
            if (found == null || !found.isOk() || !Js.array(found.value())) return AccountOutcome.unavailable("current-car");
            relationships = found.value();
        } catch (RuntimeException e) {
            return AccountOutcome.unavailable("current-car");
        }
        try {
            return AccountOutcome.ok(projection(p, relationships));
        } catch (RuntimeException e) {
            return AccountOutcome.unavailable("invalid-source");
        }
    }

    private Prepared prepare(AccountScope identity) {
        Prepared p = new Prepared();
        p.scope = identity;
        try {
            ClockReading reading = clock.now(identity);
            if (reading == null || reading.now() == null || Js.epochMillis(reading.now()) == null) {
                return fail(p, "clock");
            }
            p.now = reading.now();
            p.clockVersion = reading.clockVersion();
        } catch (RuntimeException e) {
            return fail(p, "clock");
        }
        long nowMillis = Js.epochMillis(p.now);
        PolicyRead read = new PolicyRead(identity.runId(), p.now, identity.policyVersion());
        try {
            SourceResult employment = records.readEmployment(identity.environmentId(), identity.runId(), identity.employeeId());
            if (employment.status().equals(SourceResult.NOT_FOUND)) return absent(p);
            if (!employment.isOk()) return fail(p, "employee-contract");
            JsonNode e = employment.value();
            if (!Js.text(Js.opt(e, "companyId")) || !Js.text(Js.opt(e, "schemeId")) || !Js.text(Js.opt(e, "gradeId"))
                    || !Js.text(Js.opt(e, "entitlementSlotId"))) return fail(p, "employee-contract-invalid");
            final AccountScope scope = identity.withMembership(Js.text(e.get("name")) ? e.get("name").textValue() : null,
                    e.get("companyId").textValue(), e.get("schemeId").textValue(), e.get("gradeId").textValue(),
                    e.get("entitlementSlotId").textValue());
            p.scope = scope;

            SourceResult account = records.readEmployeeContract(scope);
            if (account.status().equals(SourceResult.NOT_FOUND)) return absent(p);
            if (!account.isOk()) return fail(p, "employee-contract");
            JsonNode a = account.value();
            if (!inScope(scope, a) || !sourceValid(Js.get(a, "source")) || !Js.text(Js.get(a, "recordSetId"))
                    || !Js.array(Js.get(a, "contracts")) || !Js.array(Js.get(a, "histories"))
                    || !Js.array(Js.get(a, "slots")) || !Js.object(Js.get(a, "account"))
                    || accountMismatch(scope, a) || contractsInvalid(scope, a) || slotsInvalid(scope, a)
                    || historiesInvalid(scope, a)) return fail(p, "employee-contract-invalid");
            if (Js.epochMillis(a.get("source").get("effectiveFrom").textValue()) > nowMillis) {
                return fail(p, "employee-not-effective");
            }
            p.account = a;
            p.schemeNames = schemeNames(read);

            SourceResult driverRead = records.readDrivers(scope);
            if (!driverRead.isOk() || driversInvalid(scope, a, driverRead.value(), nowMillis)) return fail(p, "driver");
            p.drivers = driverRead.value();

            PolicyOutcome configuration = policy.manualRules(read);
            PolicyOutcome allowance = configuration.isOk() ? policy.allowance(scope, read) : null;
            PolicyOutcome scheme = !configuration.isOk() ? configuration : allowance;
            if ("invalid".equals(scheme.status()) && UNKNOWN_CODES.contains(scheme.code())) {
                p.state = scheme.code();
                return p;
            }
            if (!scheme.isOk() || !allowance.isOk() || !eq(allowance.policyVersion(), scope.policyVersion())
                    || !eq(configuration.policyVersion(), scope.policyVersion())) return fail(p, "scheme-collection");
            p.configuration = configuration.value();
            p.allowance = allowance.value();
            p.rules = Js.get(p.configuration, "value");
            if (!validRules(p.rules)) return fail(p, "manual-policy-invalid");

            p.slot = find(Js.get(a, "slots"), s -> Js.eqStr(Js.get(s, "entitlementSlotId"), scope.entitlementSlotId())
                    && Js.eqStr(Js.get(s, "employeeId"), scope.employeeId()));
            p.contract = find(Js.get(a, "contracts"), c -> p.slot != null
                    && Js.strictEq(Js.get(c, "contractId"), Js.get(p.slot, "contractId"))
                    && Js.strictEq(Js.get(c, "slotId"), Js.get(p.slot, "entitlementSlotId"))
                    && Js.eqStr(Js.get(c, "schemeId"), scope.schemeId()));
            p.state = !Js.includes(p.rules.get("enabledSchemes"), scope.schemeId()) ? "unsupported-scheme"
                    : p.slot == null || !Js.safeInt(p.slot.get("capacity"))
                            || p.slot.get("capacity").decimalValue().signum() <= 0
                            || Js.includes(F.arrayNode().add("disabled").add("allocated"), p.slot.get("state"))
                            ? "no-entitlement"
                            : Js.truthy(p.slot.get("contractId")) && p.contract == null ? "no-contract" : "ready";
            JsonNode window = p.contract != null ? p.contract : p.slot;
            for (String key : List.of("earliestCollectionDate", "latestCollectionDate")) {
                JsonNode v = Js.opt(window, key);
                if (!Js.nullish(v) && !Js.calendarDate(v)) return fail(p, "renewal-window-invalid");
            }
            if (p.state.equals("ready") && (Js.truthy(Js.opt(window, "earliestCollectionDate"))
                    || Js.truthy(Js.opt(window, "latestCollectionDate"))) && collectionDates(p, null).isEmpty()) {
                p.state = orderingClosed(p, window) ? "ordering-closed" : "not-yet-eligible";
            }
            p.contextVersion = contextVersion(p, a);
            return p;
        } catch (RuntimeException e) {
            return fail(p, "invalid-source");
        }
    }

    private static Prepared fail(Prepared p, String source) {
        p.error = AccountOutcome.unavailable(source);
        return p;
    }

    private static Prepared absent(Prepared p) {
        p.state = "absent-hr-account";
        p.account = null;
        return p;
    }

    private static boolean eq(String a, String b) {
        return a != null && a.equals(b);
    }

    private static boolean inScope(AccountScope s, JsonNode v) {
        return Js.eqStr(Js.opt(v, "runId"), s.runId()) && Js.eqStr(Js.opt(v, "environmentId"), s.environmentId())
                && Js.eqStr(Js.opt(v, "employeeId"), s.employeeId());
    }

    private static boolean sourceValid(JsonNode v) {
        return Js.object(v) && SOURCE_MODES.stream().anyMatch(m -> Js.eqStr(v.get("mode"), m))
                && Js.text(v.get("sourceRef")) && Js.text(v.get("sourceVersion")) && Js.text(v.get("schemaVersion"))
                && Js.validInstant(v.get("effectiveFrom")) && Js.validInstant(v.get("observedAt"));
    }

    private static boolean accountMismatch(AccountScope s, JsonNode a) {
        JsonNode acc = a.get("account");
        return !Js.eqStr(acc.get("employeeId"), s.employeeId()) || !Js.eqStr(acc.get("companyId"), s.companyId())
                || !Js.eqStr(acc.get("gradeId"), s.gradeId()) || !Js.eqStr(acc.get("schemeId"), s.schemeId());
    }

    private static boolean contractsInvalid(AccountScope s, JsonNode a) {
        for (JsonNode c : a.get("contracts")) {
            if (!Js.eqStr(Js.get(c, "employeeId"), s.employeeId()) || !Js.text(c.get("contractId"))
                    || !Js.text(c.get("schemeId")) || !Js.text(c.get("slotId"))) return true;
        }
        return false;
    }

    private static boolean slotsInvalid(AccountScope s, JsonNode a) {
        for (JsonNode slot : a.get("slots")) {
            if (!Js.eqStr(Js.get(slot, "runId"), s.runId()) || !Js.eqStr(slot.get("employeeId"), s.employeeId())) {
                return true;
            }
        }
        return false;
    }

    private static boolean historiesInvalid(AccountScope s, JsonNode a) {
        for (JsonNode h : a.get("histories")) {
            if (!Js.text(Js.get(h, "schemeId")) || !Js.array(h.get("entries"))) return true;
            for (JsonNode e : h.get("entries")) {
                if (!Js.eqStr(Js.get(e, "employeeId"), s.employeeId())
                        || !Js.strictEq(e.get("schemeId"), h.get("schemeId"))) return true;
            }
        }
        return false;
    }

    private static boolean driversInvalid(AccountScope s, JsonNode a, JsonNode d, long nowMillis) {
        if (!inScope(s, d) || !sourceValid(Js.get(d, "source"))
                || Js.epochMillis(d.get("source").get("effectiveFrom").textValue()) > nowMillis) return true;
        JsonNode accountVersion = a.get("repositoryVersion");
        JsonNode driverVersion = d.get("repositoryVersion");
        if (accountVersion != null && driverVersion != null && !Js.strictEq(accountVersion, driverVersion)) return true;
        if (!Js.strictEq(d.get("recordSetId"), a.get("recordSetId")) || !Js.array(d.get("drivers"))
                || !Js.object(d.get("employeeFacts"))) return true;
        Set<String> ids = new HashSet<>();
        for (JsonNode driver : d.get("drivers")) {
            if (!Js.text(Js.get(driver, "driverId")) || !Js.eqStr(driver.get("employeeId"), s.employeeId())) return true;
            ids.add(driver.get("driverId").textValue());
        }
        return ids.size() != d.get("drivers").size();
    }

    /** Display names are optional stand-ins; a missing or malformed entry leaves no label. */
    private Map<String, String> schemeNames(PolicyRead read) {
        PolicyOutcome row = policy.schemeDisplayNames(read);
        JsonNode names = row.isOk() ? Js.opt(Js.opt(row.value(), "value"), "names") : null;
        Map<String, String> out = new java.util.LinkedHashMap<>();
        if (Js.object(names)) {
            names.fields().forEachRemaining(en -> {
                if (Js.text(en.getValue())) out.put(en.getKey(), en.getValue().textValue());
            });
        }
        return out;
    }

    private static boolean positive(JsonNode n) {
        return n.decimalValue().signum() > 0;
    }

    private static boolean validRules(JsonNode r) {
        if (!Js.object(r) || !Js.array(r.get("enabledSchemes")) || !Js.array(r.get("brands"))
                || !Js.array(r.get("contractOptions"))) return false;
        for (JsonNode c : r.get("contractOptions")) {
            if (!(Js.text(Js.get(c, "contractOptionId")) && Js.array(c.get("schemeIds")) && Js.array(c.get("driverKinds"))
                    && Js.safeInt(c.get("months")) && positive(c.get("months")) && Js.safeInt(c.get("annualMileage"))
                    && positive(c.get("annualMileage")) && Js.eqStr(c.get("mileageUnit"), "mi/year"))) return false;
        }
        if (!Js.array(r.get("locations"))) return false;
        for (JsonNode l : r.get("locations")) {
            if (!(Js.text(Js.get(l, "locationId")) && Js.array(l.get("contractOptionIds"))
                    && Js.array(l.get("driverKinds")))) return false;
        }
        JsonNode min = r.get("minimumLeadDays");
        JsonNode max = r.get("maximumLeadDays");
        return Js.safeInt(min) && min.decimalValue().signum() >= 0 && Js.safeInt(max)
                && max.decimalValue().compareTo(min.decimalValue()) >= 0 && Js.safeInt(r.get("maximumSpecialRequirements"))
                && positive(r.get("maximumSpecialRequirements")) && Js.safeInt(r.get("maximumReturnMileage"))
                && positive(r.get("maximumReturnMileage")) && Js.object(r.get("insuranceMaximumByGrade"));
    }

    private interface Match {
        boolean test(JsonNode n);
    }

    private static JsonNode find(JsonNode array, Match m) {
        for (JsonNode n : array) if (m.test(n)) return n;
        return null;
    }

    private static boolean closedOn(JsonNode location, String date) {
        JsonNode closed = Js.get(location, "closedDates");
        if (Js.nullish(closed)) return false;
        if (closed.isArray()) return Js.includes(closed, date);
        if (closed.isTextual()) return closed.textValue().contains(date);
        throw new IllegalStateException("closedDates has no includes");
    }

    /** Valid collection dates from minimumLeadDays up to maxLead (default maximumLeadDays). */
    private static List<String> collectionDates(Prepared p, Long maxLead) {
        long day = 86_400_000L;
        long today = Js.midnight(p.now.substring(0, 10));
        JsonNode window = p.contract != null ? p.contract : p.slot;
        JsonNode earliest = Js.opt(window, "earliestCollectionDate");
        JsonNode latest = Js.opt(window, "latestCollectionDate");
        long min = p.rules.get("minimumLeadDays").decimalValue().longValueExact();
        long max = maxLead != null ? maxLead : p.rules.get("maximumLeadDays").decimalValue().longValueExact();
        List<String> dates = new java.util.ArrayList<>();
        for (long lead = min; lead <= max; lead++) {
            String date = Js.isoDay(today + lead * day);
            if ((!Js.truthy(earliest) || date.compareTo(earliest.textValue()) >= 0)
                    && (!Js.truthy(latest) || date.compareTo(latest.textValue()) <= 0) && dateOffered(p, date)) {
                dates.add(date);
            }
        }
        return dates;
    }

    private static boolean dateOffered(Prepared p, String date) {
        JsonNode schemeId = p.account.get("account").get("schemeId");
        for (JsonNode location : p.rules.get("locations")) {
            if (closedOn(location, date)) continue;
            for (JsonNode option : p.rules.get("contractOptions")) {
                if (!Js.includes(option.get("schemeIds"), schemeId)
                        || !Js.includes(location.get("contractOptionIds"), option.get("contractOptionId"))) continue;
                for (JsonNode driver : p.drivers.get("drivers")) {
                    JsonNode kind = driver.get("kind");
                    if (Js.includes(option.get("driverKinds"), kind) && Js.includes(location.get("driverKinds"), kind)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /** Closed, not early: no date up to the window's end can ever meet the minimum lead. */
    private static boolean orderingClosed(Prepared p, JsonNode window) {
        JsonNode latest = Js.opt(window, "latestCollectionDate");
        if (!Js.truthy(latest)) return false;
        long days = Math.floorDiv(Js.midnight(latest.textValue()) - Js.midnight(p.now.substring(0, 10)), 86_400_000L);
        return collectionDates(p, days).isEmpty();
    }

    private static String contextVersion(Prepared p, JsonNode a) {
        ObjectNode in = F.objectNode();
        in.put("runId", p.scope.runId()).put("employeeId", p.scope.employeeId()).put("schemeId", p.scope.schemeId())
                .put("companyId", p.scope.companyId()).put("gradeId", p.scope.gradeId());
        // A claim bumps the slot revision without changing its entitlement facts.
        if (p.slot == null) {
            in.putNull("slot");
        } else {
            ObjectNode slot = p.slot.deepCopy();
            slot.remove(List.of("version", "createdAt", "updatedAt"));
            in.set("slot", slot);
        }
        in.set("accountSource", a.get("source"));
        in.set("driverSource", p.drivers.get("source"));
        in.set("repositoryVersion", orNull(a.get("repositoryVersion")));
        in.set("recordSetId", a.get("recordSetId"));
        in.put("policyVersion", p.scope.policyVersion());
        in.set("configuration", p.configuration);
        in.put("orderingState", p.state);
        return Canonical.digest(in);
    }

    private static JsonNode orNull(JsonNode n) {
        return Js.nullish(n) ? F.nullNode() : n;
    }

    private static ObjectNode presentation(String state) {
        boolean orderable = state.equals("ready");
        ObjectNode view = F.objectNode();
        view.put("state", state).put("editable", orderable).put("supportOwner", orderable ? "employee" : "scheme-support")
                .put("action", orderable ? "choose-order-options" : "contact-support");
        ObjectNode fields = view.putObject("fields");
        fields.set("account", field(false, "hr-support"));
        fields.set("licence", field(false, "driver-support"));
        fields.set("driver", field(orderable, "driver-support"));
        fields.set("contract", field(orderable, "scheme-support"));
        fields.set("collection", field(orderable, "collection-support"));
        fields.set("contact", field(orderable, "employee"));
        fields.set("expectedReturnMileage", field(orderable, "employee"));
        fields.set("specialRequirements", field(orderable, "employee"));
        return view;
    }

    private static ObjectNode field(boolean editable, String owner) {
        return F.objectNode().put("editable", editable).put("supportOwner", owner);
    }

    private static JsonNode projection(Prepared p, JsonNode relationships) {
        AccountScope ctx = p.scope;
        ObjectNode out = F.objectNode();
        ObjectNode view = presentation(p.state);
        out.put("state", p.state).put("asOf", p.now);
        if (p.account == null) {
            out.putNull("account");
            out.set("drivers", F.arrayNode());
            out.set("contracts", F.arrayNode());
            out.set("slots", F.arrayNode());
            out.set("histories", F.arrayNode());
            out.set("actions", F.arrayNode());
            out.set("view", view);
            return out;
        }
        boolean ready = p.state.equals("ready");
        ArrayNode actions = F.arrayNode();
        if (ready) {
            ObjectNode action = actions.addObject();
            action.put("action", p.contract != null ? "replace" : "order").set("slotId", p.slot.get("entitlementSlotId"));
            action.put("schemeId", ctx.schemeId());
            action.set("oldContractId", p.contract != null ? orNull(p.contract.get("contractId")) : F.nullNode());
            action.put("enabled", true);
        }
        ObjectNode account = ((ObjectNode) p.account.get("account")).deepCopy();
        ArrayNode roles = account.putArray("roles");
        ctx.roles().forEach(roles::add);
        out.set("account", account);
        out.set("drivers", p.drivers.get("drivers"));
        out.set("contracts", p.account.get("contracts"));
        ArrayNode slots = out.putArray("slots");
        for (JsonNode s : p.account.get("slots")) {
            ObjectNode slot = ((ObjectNode) s).deepCopy();
            boolean trusted = Js.eqStr(s.get("entitlementSlotId"), ctx.entitlementSlotId());
            ObjectNode ordering = slot.putObject("ordering");
            ordering.put("enabled", trusted && ready);
            if (!trusted) ordering.put("reason", "outside-trusted-context");
            else if (ready) ordering.putNull("reason");
            else ordering.put("reason", p.state);
            slots.add(slot);
        }
        out.set("currentContract", p.contract != null ? p.contract : F.nullNode());
        out.put("contractState", p.contract != null ? "current-contract" : "no-contract");
        if (relationships.size() > 0) out.set("currentCarRelationships", relationships);
        ArrayNode histories = out.putArray("histories");
        for (JsonNode h : p.account.get("histories")) {
            ObjectNode history = ((ObjectNode) h).deepCopy();
            String label = p.schemeNames.get(h.get("schemeId").textValue());
            if (label != null) history.put("label", label);
            int count = h.get("entries").size();
            history.put("state", count > 0 ? "history" : "empty-history").put("count", count);
            history.put("orderingSupported", p.rules != null && Js.includes(p.rules.get("enabledSchemes"), h.get("schemeId")));
            histories.add(history);
        }
        out.set("actions", actions);
        out.set("choices", choices(p));
        out.set("allowance", p.allowance != null ? p.allowance : F.nullNode());
        ArrayNode assumptions = out.putArray("assumptions");
        if (p.configuration != null) assumptions.add(p.configuration);
        out.set("contextVersion", p.contextVersion != null ? F.textNode(p.contextVersion) : F.nullNode());
        ObjectNode versions = out.putObject("versions");
        versions.put("policy", ctx.policyVersion());
        versions.set("employeeContract", p.account.get("source"));
        versions.set("driver", p.drivers.get("source"));
        versions.set("recordSetId", p.account.get("recordSetId"));
        versions.set("employee", orNull(p.account.get("repositoryVersion")));
        versions.set("slot", p.slot == null ? F.nullNode() : orNull(p.slot.get("version")));
        versions.put("clock", p.clockVersion);
        out.set("view", view);
        return out;
    }

    private static JsonNode choices(Prepared p) {
        if (p.rules == null) return F.nullNode();
        ObjectNode choices = F.objectNode();
        choices.put("schemeId", p.scope.schemeId());
        choices.set("slotId", p.slot == null ? F.nullNode() : orNull(p.slot.get("entitlementSlotId")));
        ArrayNode drivers = choices.putArray("drivers");
        for (JsonNode d : p.drivers.get("drivers")) {
            ObjectNode pick = drivers.addObject();
            for (String key : List.of("driverId", "name", "kind")) {
                if (d.has(key)) pick.set(key, d.get(key));
            }
        }
        choices.set("contractOptions", p.rules.get("contractOptions"));
        choices.set("collectionLocations", p.rules.get("locations"));
        choices.set("brands", p.rules.get("brands"));
        return choices;
    }
}
