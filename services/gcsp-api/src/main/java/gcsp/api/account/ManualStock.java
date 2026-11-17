package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountService.Prepared;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import gcsp.api.recommendation.Gates;
import gcsp.api.recommendation.RecommendationClock;
import gcsp.api.recommendation.RecommendationConfig;
import gcsp.api.recommendation.RecommendationContext;
import gcsp.api.recommendation.RecommendationService;
import gcsp.api.recommendation.RecommendationSource;
import gcsp.api.recommendation.ReleasedStockRecommendationSource;
import gcsp.api.recommendation.StockPages;
import gcsp.api.recommendation.VehicleEvidencePort;
import gcsp.api.supply.ReleasedCar;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Browse of the released stock for the employee's saved manual draft: Node's ManualContextService #browseStock.
 * Nothing is reserved; every gate is evaluated here from the draft's chosen driver and the collection date.
 */
public final class ManualStock {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String CALIBRATION = "employee.recommendation.v1";
    private static final String CONTRACT_VERSION = "1.0.0";
    private static final List<String> HANDLED = List.of("invalid", "forbidden", "stale-run", "unavailable");

    /** The outcome, plus what a claim needs from the same read: the slot and each shown car's recorded facts. */
    public record Browsed(AccountOutcome outcome, String slotId, Map<String, JsonNode> carFacts) {}

    /** The slot and versions a claim is checked against; the driver is the draft's chosen one. */
    public record Standing(String slotId, String contextVersion, long draftVersion, String driverId) {}

    /** What ordering snapshots from the draft and account (manual-conversion.js prepare). */
    public record OrderFacts(String mode, JsonNode driver, JsonNode contact, JsonNode employee, JsonNode sourceVersions) {}

    /** One gate result: a blocker or an unknown, as the Node evidence object. */
    record Finding(boolean blocker, ObjectNode entry) {}

    private final AccountService accounts;
    private final ManualDrafts drafts;
    private final PolicyService policy;
    private final StockPages stock;
    private final VehicleEvidencePort evidence;
    private final RecommendationClock clock;

    public ManualStock(AccountService accounts, ManualDrafts drafts, PolicyService policy, StockPages stock,
            VehicleEvidencePort evidence, RecommendationClock clock) {
        this.accounts = accounts;
        this.drafts = drafts;
        this.policy = policy;
        this.stock = stock;
        this.evidence = evidence;
        this.clock = clock;
    }

    /** ownedOrderUuid is the employee's own held car, which stays available to them (revalidateHeldSelection). */
    public Browsed browse(AccountScope identity, String ownedOrderUuid) {
        Prepared p = accounts.prepare(identity);
        if (p.error != null) return failed(p.error);
        if (!"ready".equals(p.state)) {
            return failed(ManualDrafts.conflict(p.state, AccountService.presentation(p.state)));
        }
        AccountOutcome saved = drafts.read(p, identity);
        if (!saved.isOk()) return failed(saved);
        JsonNode draft = saved.value();
        if (Js.eqBool(draft.get("requiresRefresh")) || !Js.eqStr(draft.get("contextVersion"), p.contextVersion)) {
            return failed(ManualDrafts.stale("manual-context", draft.get("contextVersion"), F.textNode(p.contextVersion)));
        }
        JsonNode choices = draft.get("choices");
        if (ManualDraftRules.isIntent(choices)) {
            return failed(ManualDrafts.conflict("order-options-required",
                    ManualDraftRules.view("order-options-required", true, "choose-order-options")));
        }
        ManualDraftRules.Validated selected = ManualDraftRules.validate(p.scope, choices, p);
        if (selected.invalid() != null) return failed(AccountOutcome.refused(selected.invalid()));
        JsonNode driver = null;
        for (JsonNode d : p.drivers.get("drivers")) {
            if (Js.strictEq(d.get("driverId"), choices.get("driverId"))) {
                driver = d;
                break;
            }
        }
        if (driver == null) return failed(AccountOutcome.refused(ManualDraftRules.invalid("driverId", "Choose who will drive the car.")));
        try {
            return browse(p, draft, driver, ownedOrderUuid);
        } catch (RuntimeException e) {
            return failed(AccountOutcome.unavailable("released-stock-invalid"));
        }
    }

    private Browsed browse(Prepared p, JsonNode draft, JsonNode driver, String owned) {
        AccountScope scope = p.scope;
        RunContext run = new RunContext(scope.environmentId(), scope.runId(), scope.employeeId());
        Map<String, JsonNode> carFacts = new HashMap<>();
        ReleasedView released = read(run, scope, owned, carFacts);
        if (released == null) return failed(AccountOutcome.unavailable("released-stock"));
        ObjectNode facts = ((ObjectNode) p.drivers.get("employeeFacts")).deepCopy();
        if (driver.get("eligible") != null) facts.set("driverEligible", driver.get("eligible"));
        ObjectNode digestInput = F.objectNode();
        digestInput.set("employee", p.account.get("source"));
        digestInput.set("driver", p.drivers.get("source"));
        digestInput.set("driverId", driver.get("driverId"));
        String factsVersion = Canonical.digest(digestInput);
        RecommendationSource source = context -> {
            ObjectNode value = F.objectNode().put("runId", scope.runId()).put("environmentId", scope.environmentId())
                    .put("employeeId", scope.employeeId()).put("factsVersion", factsVersion)
                    .put("stockVersion", released.version());
            value.set("employeeFacts", facts);
            value.set("stock", released.cars());
            ObjectNode out = F.objectNode().put("status", "ok");
            out.set("value", value);
            return out.put("contractVersion", CONTRACT_VERSION);
        };
        RecommendationContext context = new RecommendationContext(scope.runId(), scope.environmentId(), scope.employeeId(),
                scope.companyId(), scope.schemeId(), scope.gradeId(), scope.policyVersion(), scope.roles(),
                scope.entitlementSlotId());
        String date = draft.get("choices").get("requestedCollectionDate").textValue();
        ObjectNode brief = F.objectNode().put("schemaVersion", 1).put("briefVersion", draft.get("draftVersion").longValue());
        brief.putObject("preferences");
        brief.putObject("essentials");
        brief.put("requiredBy", date + "T23:59:59.999Z");
        ObjectNode checked = new RecommendationService(source, policy, clock).recommend(context, brief);
        if (!Js.eqStr(checked.get("status"), "ok")) return failed(passThrough(checked));
        PolicyResult calibration = policy.getAssumption(CALIBRATION, new PolicyRead(scope.runId(), p.now, scope.policyVersion()));
        if (!calibration.ok()) return failed(AccountOutcome.unavailable("policy"));
        RecommendationConfig config = new RecommendationConfig(calibration.value().get("value"));
        JsonNode maximum = p.rules.get("insuranceMaximumByGrade").get(scope.gradeId());
        JsonNode licence = driver.get("licence");
        long draftVersion = draft.get("draftVersion").longValue();
        ArrayNode decisions = F.arrayNode();
        List<ObjectNode> eligible = new ArrayList<>();
        for (JsonNode raw : checked.get("value").get("decisions")) {
            ObjectNode decision = ((ObjectNode) raw).deepCopy();
            ArrayNode blockers = copy(decision.get("blockers"));
            ArrayNode unknowns = copy(decision.get("unknowns"));
            add(licenceGate(licence, date), blockers, unknowns);
            JsonNode insurance = Js.opt(Js.opt(decision.get("snapshot"), "facts"), "insuranceGroup");
            add(insuranceGate(maximum, insurance, config), blockers, unknowns);
            String gate = blockers.size() > 0 ? "ineligible" : unknowns.size() > 0 ? "needs-confirmation" : "eligible";
            decision.putNull("score");
            decision.set("components", F.arrayNode());
            decision.put("gateStatus", gate).put("suitable", gate.equals("eligible"));
            decision.set("blockers", blockers);
            decision.set("unknowns", unknowns);
            decision.set("orderNumber", released.numbers().get(decision.get("orderUuid").textValue()));
            decision.put("draftVersion", draftVersion);
            decision.set("view", F.objectNode().put("state", gate).put("editable", false)
                    .put("supportOwner", gate.equals("needs-confirmation") ? "scheme-support" : "employee")
                    .put("action", gate.equals("eligible") ? "review-car"
                            : gate.equals("needs-confirmation") ? "request-confirmation" : "choose-another-car"));
            decisions.add(decision);
            if (gate.equals("eligible")) eligible.add(decision);
        }
        eligible.sort((a, b) -> a.get("orderNumber").textValue().compareTo(b.get("orderNumber").textValue()));
        ArrayNode cars = F.arrayNode();
        eligible.forEach(cars::add);
        ObjectNode value = F.objectNode();
        value.put("state", decisions.size() == 0 ? "empty-stock" : eligible.isEmpty() ? "no-eligible-stock" : "available-stock");
        value.set("decisions", decisions);
        value.set("cars", cars);
        value.put("total", eligible.size()).put("ranked", false).put("browsingReservesStock", false);
        ObjectNode versions = ((ObjectNode) checked.get("value").get("versions")).deepCopy();
        versions.put("draft", draftVersion).put("context", p.contextVersion);
        value.set("versions", versions);
        value.set("assumptions", F.arrayNode().add(p.configuration));
        value.set("view", F.objectNode().put("state", eligible.isEmpty() ? "empty" : "available").put("editable", false)
                .put("supportOwner", "scheme-support")
                .put("action", eligible.isEmpty() ? "retry-or-contact-support" : "review-car"));
        return new Browsed(AccountOutcome.ok(value), p.slot.get("entitlementSlotId").textValue(), carFacts);
    }

    /** The employee's slot and versions for a claim; empty when there is no complete, current draft to claim against. */
    public Optional<Standing> standing(AccountScope identity) {
        Prepared p = accounts.prepare(identity);
        JsonNode draft = usable(p, identity);
        if (draft == null || ManualDraftRules.isIntent(draft.get("choices"))) return Optional.empty();
        JsonNode driverId = draft.get("choices").get("driverId");
        return Optional.of(new Standing(p.slot.get("entitlementSlotId").textValue(), p.contextVersion,
                draft.get("draftVersion").longValue(), Js.text(driverId) ? driverId.textValue() : null));
    }

    /** Ordering's draft: mode, chosen driver, contact, the account's employee and its source versions. */
    public Optional<OrderFacts> orderFacts(AccountScope identity) {
        Prepared p = accounts.prepare(identity);
        JsonNode draft = usable(p, identity);
        if (draft == null) return Optional.empty();
        JsonNode choices = draft.get("choices");
        if (!Js.text(choices.get("driverId")) || !Js.text(choices.get("contractOptionId")) || !Js.truthy(choices.get("contact"))) {
            return Optional.empty();
        }
        JsonNode driver = null;
        for (JsonNode d : p.drivers.get("drivers")) {
            if (Js.strictEq(d.get("driverId"), choices.get("driverId"))) driver = d;
        }
        if (driver == null) return Optional.empty();
        ObjectNode employee = ((ObjectNode) p.account.get("account")).deepCopy();
        ArrayNode roles = employee.putArray("roles");
        identity.roles().forEach(roles::add);
        return Optional.of(new OrderFacts(choices.get("mode").textValue(), driver, choices.get("contact"), employee,
                AccountService.versions(p)));
    }

    /** The saved draft when the account is ready and the draft is not waiting for a refresh; else null. */
    private JsonNode usable(Prepared p, AccountScope identity) {
        if (p.error != null || !"ready".equals(p.state)) return null;
        AccountOutcome saved = drafts.read(p, identity);
        if (!saved.isOk() || Js.eqBool(saved.value().get("requiresRefresh"))) return null;
        return saved.value();
    }

    /** Licence gate: unconfirmed licence facts are an unknown; a licence not valid for a car on the date is a blocker. */
    static Finding licenceGate(JsonNode licence, String date) {
        if (!AccountService.sourceValid(Js.opt(licence, "source")) || !Js.calendarDate(Js.opt(licence, "validFrom"))
                || !Js.calendarDate(Js.opt(licence, "validUntil")) || !Js.array(Js.opt(licence, "categories"))) {
            return new Finding(false, F.objectNode().put("code", "licence-unconfirmed"));
        }
        if (licence.get("validFrom").textValue().compareTo(date) > 0 || licence.get("validUntil").textValue().compareTo(date) < 0
                || !Js.includes(licence.get("categories"), "car")) {
            return new Finding(true, F.objectNode().put("code", "licence-not-valid-at-collection"));
        }
        return null;
    }

    /** Insurance gate: the grade's maximum against a confirmed insurance group fact. */
    static Finding insuranceGate(JsonNode maximum, JsonNode insurance, RecommendationConfig config) {
        if (maximum == null || !maximum.isNumber() || !Gates.confirmedFact(insurance, config)
                || insurance.get("value") == null || !insurance.get("value").isNumber()) {
            return new Finding(false, F.objectNode().put("code", "insurance-unconfirmed"));
        }
        if (insurance.get("value").decimalValue().compareTo(maximum.decimalValue()) > 0) {
            ObjectNode blocker = F.objectNode().put("code", "insurance-grade-limit");
            blocker.set("maximum", maximum);
            blocker.set("actual", insurance.get("value"));
            blocker.put("assumptionKey", "manual.context.v1");
            return new Finding(true, blocker);
        }
        return null;
    }

    private static void add(Finding f, ArrayNode blockers, ArrayNode unknowns) {
        if (f != null) (f.blocker() ? blockers : unknowns).add(f.entry());
    }

    private static ArrayNode copy(JsonNode list) {
        ArrayNode out = F.arrayNode();
        if (list != null && list.isArray()) out.addAll((ArrayNode) list);
        return out;
    }

    private static Browsed failed(AccountOutcome outcome) {
        return new Browsed(outcome, null, Map.of());
    }

    /** A refusal of the recommendation service keeps its own body; anything it does not map is unavailable. */
    private static AccountOutcome passThrough(ObjectNode body) {
        String status = body.get("status").asText();
        if (!HANDLED.contains(status)) return AccountOutcome.unavailable("recommendation");
        ObjectNode out = body.deepCopy();
        out.remove("contractVersion");
        return AccountOutcome.refused(out);
    }

    private record ReleasedView(String version, ArrayNode cars, Map<String, JsonNode> numbers) {}

    /** Every released car paged to exhaustion, then the ones visible to the employee; null when unusable. */
    private ReleasedView read(RunContext run, AccountScope scope, String owned, Map<String, JsonNode> carFacts) {
        List<ReleasedCar> all = new ArrayList<>();
        try {
            String after = null;
            while (true) {
                List<ReleasedCar> page = stock.page(run, after, ReleasedStockRecommendationSource.PAGE);
                all.addAll(page);
                if (page.size() < ReleasedStockRecommendationSource.PAGE) break;
                after = page.get(page.size() - 1).orderUuid();
            }
        } catch (SQLException | RuntimeException e) {
            return null;
        }
        List<String> versions = new ArrayList<>();
        ArrayNode cars = F.arrayNode();
        Map<String, JsonNode> numbers = new HashMap<>();
        for (ReleasedCar car : all) {
            JsonNode visibility = car.attributes().get("visibility");
            if (!visibilityValid(visibility)) return null;
            versions.add(car.orderUuid() + ":" + car.version());
            if (!visible(visibility, scope)) continue;
            JsonNode number = car.attributes().get("orderNumber");
            if (number == null || !number.isTextual() || !number.textValue().matches("\\d{7}")) return null;
            Optional<JsonNode> snapshot = evidence.snapshot(run, car.orderUuid(), car.configurationId(), car.attributes().get("facts"));
            if (snapshot.isEmpty()) return null;
            JsonNode release = car.attributes().get("release");
            JsonNode listed = release == null ? null : release.get("availability");
            ObjectNode availability = listed != null && listed.isObject() ? ((ObjectNode) listed).deepCopy() : F.objectNode();
            if (car.orderUuid().equals(owned)) availability.put("state", "available");
            else if (car.occupied()) availability.put("state", "unavailable");
            ObjectNode row = F.objectNode().put("orderUuid", car.orderUuid());
            row.set("orderNumber", number);
            row.put("configurationId", car.configurationId());
            row.set("snapshot", snapshot.get());
            row.set("availability", availability);
            cars.add(row);
            numbers.put(car.orderUuid(), number);
            carFacts.put(car.orderUuid(), car.attributes().get("facts"));
        }
        versions.sort(null);
        return new ReleasedView("stock:" + String.join("|", versions), cars, numbers);
    }

    private static boolean visibilityValid(JsonNode v) {
        return Js.object(v) && Js.array(v.get("companyIds")) && Js.array(v.get("schemeIds"))
                && v.get("employeeIds") != null && (v.get("employeeIds").isNull() || v.get("employeeIds").isArray());
    }

    private static boolean visible(JsonNode v, AccountScope s) {
        return Js.includes(v.get("companyIds"), s.companyId()) && Js.includes(v.get("schemeIds"), s.schemeId())
                && (v.get("employeeIds").isNull() || Js.includes(v.get("employeeIds"), s.employeeId()));
    }
}
