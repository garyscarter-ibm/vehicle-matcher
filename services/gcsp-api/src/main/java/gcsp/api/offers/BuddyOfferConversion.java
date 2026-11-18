package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.SourceResult;
import gcsp.api.identity.Principal;
import gcsp.api.offers.OfferDecisions.Locked;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.SelectionConversionPort;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Tx;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * The Buddy offer source for ordering (FUCQ-466). One instance per accept: prepare reads the account outside the
 * transaction, and convert rechecks and allocates inside ordering's, so the decision and selection commit together.
 */
final class BuddyOfferConversion implements SelectionConversionPort {

    /** What this one accept was asked for. */
    record Ask(Principal principal, String offerId, String commandId, String digest, long expectedOfferVersion,
            Long expectedReturnMileage, boolean browserCommand) {
        Ask(Principal principal, String offerId, String commandId, String digest, long expectedOfferVersion,
                Long expectedReturnMileage) {
            this(principal, offerId, commandId, digest, expectedOfferVersion, expectedReturnMileage, false);
        }
    }

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Pattern PHONE = Pattern.compile("^\\+?[0-9 ()-]{7,30}$");
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private static final String UNAVAILABLE = "selection-source-unavailable";

    private final OfferDecisions decisions;
    private final OfferDecisions.Verdict verdict;
    private final Ask ask;

    BuddyOfferConversion(OfferDecisions decisions, OfferDecisions.Verdict verdict, Ask ask) {
        this.decisions = decisions;
        this.verdict = verdict;
        this.ask = ask;
    }

    @Override
    public String sourceType() {
        return "buddy-offer";
    }

    private Refusal refuse(OfferOutcome outcome) {
        verdict.outcome = outcome;
        return new Refusal(outcome.code());
    }

    private Refusal conflict(String code, String reason) {
        return refuse(OfferOutcome.of(409, "conflict", code, reason, false));
    }

    private Refusal unavailable() {
        return refuse(OfferOutcome.of(503, "unavailable", UNAVAILABLE, "Your account details are unavailable right now. "
                + "Try again shortly.", true));
    }

    // ---- prepare: outside the transaction ----

    @Override
    public Preparation prepare(OrderingScope scope, SourceInput source) {
        try {
            AccountRecordsPort port = decisions.accounts();
            Instant now = decisions.clock().now(scope.context());
            if (port == null || now == null) return unavailable();
            AccountScope who = new AccountScope(scope.environmentId(), scope.runId(), scope.employeeId(), null,
                    List.of("employee"), null, null, null, scope.entitlementSlotId(), scope.policyVersion());
            SourceResult contract = port.readEmployeeContract(who);
            SourceResult drivers = port.readDrivers(who);
            if (!contract.isOk() || !drivers.isOk()) return unavailable();
            JsonNode account = contract.value().path("account");
            JsonNode contact = account.path("contact");
            if (!validContact(contact)) return conflict("contact-required", "Add a phone number and email address.");
            JsonNode driver = employeeDriver(drivers.value().path("drivers"), scope.employeeId());
            if (!driverOk(driver, now.toString().substring(0, 10))) {
                return conflict("driver-review-required", "Your driver details need review.");
            }
            JsonNode current = currentContract(contract.value().path("contracts"), scope.entitlementSlotId());
            if (current != null && !returnOk(current)) {
                return conflict("return-data-required", "The details of the car you return need review.");
            }
            boolean replacement = current != null;
            Long mileage = ask.expectedReturnMileage();
            if (replacement) {
                PolicyResult rules = decisions.policy().getAssumption("manual.context.v1",
                        new PolicyRead(scope.runId(), PolicyClock.iso(now), scope.policyVersion()));
                JsonNode max = rules.ok() && rules.value() != null ? rules.value().path("value").path("maximumReturnMileage") : null;
                if (max == null || !scope.policyVersion().equals(rules.policyVersion()) || !max.isIntegralNumber()
                        || !max.canConvertToLong()) {
                    return conflict("return-mileage-requirements-unavailable", "The return mileage rules are unavailable.");
                }
                if (mileage == null || mileage < 0 || mileage > max.longValue()) {
                    return refuse(OfferOutcome.invalid("expected-return-mileage-required",
                            "Enter a whole expected return mileage from 0 to " + String.format("%,d", max.longValue()) + " miles."));
                }
            } else if (mileage != null) {
                return conflict("return-mileage-not-applicable", "Mileage applies only when you replace a car.");
            }
            ObjectNode versions = F.objectNode();
            versions.set("employee", contract.value().get("repositoryVersion"));
            versions.put("brief", source.expectedDraftVersion());
            if (replacement) versions.putObject("returnOdometer").put("value", mileage).put("unit", "mi");
            else versions.putNull("returnOdometer");
            return new Prepared(replacement ? "replacement" : "new", driver, contact, account, versions);
        } catch (RuntimeException e) {
            return unavailable();
        }
    }

    static boolean validContact(JsonNode c) {
        if (!c.isObject() || c.size() != 2 || !c.path("phone").isTextual() || !c.path("email").isTextual()) return false;
        return PHONE.matcher(c.get("phone").textValue()).matches() && c.get("email").textValue().length() <= 254
                && EMAIL.matcher(c.get("email").textValue()).matches();
    }

    static JsonNode employeeDriver(JsonNode drivers, String employeeId) {
        for (JsonNode d : drivers) {
            if ("employee".equals(d.path("kind").asText()) && employeeId.equals(d.path("employeeId").asText(null))) return d;
        }
        return null;
    }

    private static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank();
    }

    private static LocalDate date(JsonNode n) {
        try {
            return text(n) ? LocalDate.parse(n.textValue()) : null;
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    static boolean driverOk(JsonNode d, String today) {
        if (d == null || !text(d.get("name")) || !d.path("eligible").path("value").isBoolean()
                || !d.path("eligible").path("value").booleanValue()) {
            return false;
        }
        JsonNode l = d.path("licence");
        boolean car = false;
        for (JsonNode c : l.path("categories")) car |= "car".equals(c.asText());
        LocalDate from = date(l.get("validFrom"));
        LocalDate until = date(l.get("validUntil"));
        LocalDate t = LocalDate.parse(today);
        return text(l.get("displayNumber")) && car && from != null && until != null && !from.isAfter(until)
                && !from.isAfter(t) && !until.isBefore(t);
    }

    static JsonNode currentContract(JsonNode contracts, String slotId) {
        for (JsonNode c : contracts) {
            if ("current".equals(c.path("status").asText()) && slotId.equals(c.path("slotId").asText(null))
                    && (c.path("returnedDate").isMissingNode() || c.path("returnedDate").isNull())) {
                return c;
            }
        }
        return null;
    }

    static boolean returnOk(JsonNode c) {
        JsonNode odo = c.path("currentOdometer");
        return text(c.get("model")) && date(c.get("contractEndDate")) != null && odo.path("value").isNumber()
                && odo.path("value").doubleValue() >= 0 && text(odo.get("unit"));
    }

    // ---- convert: inside ordering's transaction ----

    @Override
    public Conversion convert(Tx tx, OrderingScope scope, ConversionRequest q) throws SQLException {
        Principal p = ask.principal();
        // The offers clock, not ordering's: holds and offers are stamped on the run clock.
        Instant now = decisions.clock().now(scope.context());
        if (now == null) return unavailable();
        Locked l = decisions.lock(tx, p, ask.offerId(), ask.expectedOfferVersion(), q.expectedHoldVersion(),
                q.expectedStockVersion(), now, verdict);
        if (l == null) return new Refusal(verdict.outcome.code());
        if (!l.holdId().equals(q.holdId()) || !l.offer().quoteId().equals(q.expectedQuoteId())
                || l.offer().briefVersion() != q.expectedDraftVersion()
                || !l.car().attributes().path("orderNumber").asText("").matches("\\d{7}")) {
            return refuse(OfferDecisions.authorityChanged());
        }
        Refusal stale = revalidate(tx, scope, l, now);
        if (stale != null) return stale;
        return write(tx, scope, q, l, now);
    }

    private PolicyContext membership;
    private JsonNode allowanceUsed;

    /** The retained quote's eligibility is judged again now: brief meaning, validity, allowance and the model rules. */
    Refusal revalidate(Tx tx, OrderingScope scope, Locked l, Instant now) throws SQLException {
        String env = scope.environmentId();
        String run = scope.runId();
        JsonNode current = tx.first("SELECT b.content::text FROM brief_heads h JOIN briefs b ON b.environment_id = h.environment_id "
                + "AND b.run_id = h.run_id AND b.employee_id = h.employee_id AND b.brief_version = h.brief_version "
                + "WHERE h.environment_id = ? AND h.run_id = ? AND h.employee_id = ?",
                rs -> OfferDecisions.json(rs.getString(1)), env, run, scope.employeeId()).orElse(null);
        JsonNode pinned = tx.first("SELECT content::text FROM briefs WHERE environment_id = ? AND run_id = ? AND employee_id = ? "
                + "AND brief_version = ?", rs -> OfferDecisions.json(rs.getString(1)), env, run,
                scope.employeeId(), l.offer().briefVersion()).orElse(null);
        if (current == null || pinned == null || !meaning(current).equals(meaning(pinned))) {
            return conflict("brief-changed-review-required", "Your brief has changed since this offer. Review it first.");
        }
        JsonNode terms = l.quote().json().path("terms");
        if (l.quote().validUntil() == null || !l.quote().validUntil().isAfter(now) || l.quote().monthlyPoints() == null
                || terms.has("validUntil") && !after(terms.get("validUntil"), now)) {
            return conflict("quote-no-longer-valid", "This offer's quote is no longer valid.");
        }
        JsonNode attrs = tx.first("SELECT attributes::text FROM employees WHERE environment_id = ? AND run_id = ? AND employee_id = ?",
                rs -> OfferDecisions.json(rs.getString(1)), env, run, scope.employeeId()).orElse(null);
        if (attrs == null || !text(attrs.get("companyId")) || !text(attrs.get("schemeId")) || !text(attrs.get("gradeId"))) {
            return refuse(OfferOutcome.of(503, "unavailable", "allowance-unavailable",
                    "Your allowance is unavailable right now. Try again shortly.", true));
        }
        membership = new PolicyContext(run, attrs.get("companyId").textValue(), attrs.get("schemeId").textValue(),
                attrs.get("gradeId").textValue());
        PolicyRead read = new PolicyRead(run, PolicyClock.iso(now), scope.policyVersion());
        PolicyResult allowance = decisions.policy().getAllowance(membership, read);
        JsonNode points = allowance.ok() && allowance.value() != null ? allowance.value().get("monthlyPoints") : null;
        if (points == null || !points.isIntegralNumber() || !scope.policyVersion().equals(allowance.policyVersion())) {
            return refuse(OfferOutcome.of(503, "unavailable", "allowance-unavailable",
                    "Your allowance is unavailable right now. Try again shortly.", true));
        }
        if (points.longValue() < l.quote().monthlyPoints()) {
            return conflict("allowance-exceeded", "This offer is now above your monthly points allowance.");
        }
        allowanceUsed = F.objectNode().put("allowanceId", allowance.value().path("allowanceId").asText(null))
                .put("monthlyPoints", points.longValue()).put("policyVersion", allowance.policyVersion());
        ObjectNode car = F.objectNode();
        l.quote().json().path("snapshot").path("facts").fields().forEachRemaining(e -> {
            if ("known".equals(e.getValue().path("status").asText())) car.set(e.getKey(), e.getValue().get("value"));
        });
        car.put("configurationId", l.car().configurationId());
        PolicyResult eligibility = decisions.policy().getEligibility(membership, car, read);
        if (!eligibility.ok() || eligibility.value() == null || !scope.policyVersion().equals(eligibility.policyVersion())) {
            return refuse(OfferOutcome.of(503, "unavailable", "current-eligibility-unavailable",
                    "Your eligibility is unavailable right now. Try again shortly.", true));
        }
        if (!eligibility.value().path("eligible").asBoolean(false) || !"eligible".equals(eligibility.value().path("state").asText())) {
            return conflict("current-eligibility-refused", "You are no longer eligible for this car.");
        }
        return null;
    }

    JsonNode allowanceUsed() {
        return allowanceUsed;
    }

    private static boolean after(JsonNode n, Instant now) {
        try {
            return n.isTextual() && Instant.parse(n.textValue()).isAfter(now);
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    /** Essential meaning only: value, operator, unit and state per essential, with includes lists sorted. */
    private static String meaning(JsonNode brief) {
        ObjectNode out = F.objectNode();
        brief.path("essentials").fields().forEachRemaining(e -> {
            JsonNode v = e.getValue();
            ObjectNode m = out.putObject(e.getKey());
            JsonNode value = v.path("value");
            if ("includes".equals(v.path("operator").asText()) && value.isArray()) {
                List<String> sorted = new ArrayList<>();
                value.forEach(x -> sorted.add(Canonical.json(x)));
                sorted.sort(null);
                var arr = m.putArray("value");
                sorted.forEach(x -> {
                    try {
                        arr.add(OfferDecisions.MAPPER.readTree(x));
                    } catch (java.io.IOException ex) {
                        throw new IllegalStateException(ex);
                    }
                });
            } else {
                m.set("value", v.has("value") ? value : F.nullNode());
            }
            m.set("operator", v.path("operator"));
            m.set("unit", v.path("unit"));
            m.set("state", v.path("state"));
        });
        return Canonical.digest(out);
    }

    private Conversion write(Tx tx, OrderingScope scope, ConversionRequest q, Locked l, Instant now) throws SQLException {
        String env = scope.environmentId();
        String run = scope.runId();
        String nowText = PolicyClock.iso(now);
        ObjectNode browserFacts = OfferDecisionPresentation.capture(tx, l, now, ask.browserCommand());
        ObjectNode patch = F.objectNode().put("allocatedAt", nowText);
        tx.cas("UPDATE custody_holds SET state = 'allocated', attributes = attributes || ?, version = version + 1, "
                + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? "
                + "AND state = 'active'", patch, env, run, l.holdId(), l.hold().version());
        tx.cas("UPDATE buddy_offers SET state = 'accepted', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND offer_id = ? AND version = ? AND state = 'active'",
                env, run, ask.offerId(), l.offer().version());
        tx.cas("UPDATE stock_cars SET state = 'allocated', version = version + 1, updated_at = now() WHERE environment_id = ? "
                + "AND run_id = ? AND order_uuid = ? AND version = ? AND state = 'released'", env, run,
                l.offer().orderUuid(), l.car().version());

        String decisionId = "offer-decision:" + Canonical.digest(F.arrayNode().add(run).add(ask.offerId()));
        ObjectNode value = F.objectNode();
        value.put("schemaVersion", 1);
        value.put("offerId", ask.offerId());
        value.put("decisionId", decisionId);
        value.put("commandId", ask.commandId());
        value.put("decision", "accept");
        value.put("state", "accepted");
        value.put("offerVersion", l.offer().version() + 1);
        value.put("holdVersion", l.hold().version() + 1);
        value.put("decidedAt", nowText);
        value.putArray("availableActions");
        value.put("operationId", q.operationId());
        OfferDecisionPresentation.retain(value, browserFacts);
        ObjectNode versions = F.objectNode();
        versions.put("offer", l.offer().version());
        versions.put("hold", l.hold().version());
        versions.put("car", l.car().version());
        versions.put("policy", scope.policyVersion());
        versions.put("briefVersion", l.offer().briefVersion());
        versions.put("quoteId", l.offer().quoteId());
        versions.set("allowance", allowanceUsed);
        versions.put("operationId", q.operationId());
        tx.write("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, command_id, input_digest, "
                + "employee_id, hold_id, decision, reason_code, reason, versions, outcome, decided_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accept', NULL, NULL, ?, ?, ?)", env, run, ask.offerId(), decisionId,
                ask.commandId(), ask.digest(), l.offer().employeeId(), l.holdId(), versions, value, now);

        ObjectNode event = F.objectNode();
        event.put("holdId", l.holdId());
        event.put("orderUuid", l.offer().orderUuid());
        event.put("offerId", ask.offerId());
        event.put("employeeId", l.offer().employeeId());
        event.put("decisionId", decisionId);
        event.put("operationId", q.operationId());
        event.put("quoteId", l.offer().quoteId());
        event.put("briefVersion", l.offer().briefVersion());
        event.put("policyVersion", scope.policyVersion());
        event.put("occurredAt", nowText);
        tx.emit("offer-accepted:" + l.holdId(), "offer-accepted", event);

        ObjectNode quote = l.quote().json().deepCopy();
        quote.put("quoteId", l.offer().quoteId());
        JsonNode renewal = l.hold().attributes().path("renewalId");
        JsonNode facts = l.quote().json().path("snapshot").path("facts");
        verdict.converted = true;
        return new Converted(l.offer().orderUuid(), l.car().attributes().path("orderNumber").asText(),
                l.car().configurationId(), quote, facts.isMissingNode() ? F.objectNode() : facts.deepCopy(),
                renewal.isTextual() ? renewal.textValue() : null);
    }
}
