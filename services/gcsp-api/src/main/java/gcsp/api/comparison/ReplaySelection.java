package gcsp.api.comparison;

import static gcsp.api.comparison.ReplayRecords.JSON;
import static gcsp.api.comparison.ReplayRecords.refuse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountOutcome;
import gcsp.api.claims.ClaimScope;
import gcsp.api.claims.ManualClaims;
import gcsp.api.claims.ManualSelectionPort;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.recommendation.Gates;
import gcsp.api.recommendation.RecommendationConfig;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The comparison's manual browse and eligibility (Node ManualContextService.browseStock): the claimant's context from
 * Java account reads, and a car's decision from the recommendation gates plus the licence and insurance gates.
 */
final class ReplaySelection implements ManualSelectionPort {

    /** A group's verdict for one employee at one instant. */
    record Eligibility(boolean eligible, ObjectNode terms, Instant validUntil) {}

    /** The account state and the per-group verdicts a listing or decision reads. */
    record Browse(String state, String contextVersion, Map<String, Eligibility> groups) {}

    private record Cached(long at, Browse browse) {}

    private final ReplayRun run;
    private final SeedEvaluation evaluation;
    private final GroupEvaluator evaluator;
    private final Map<String, ReplayStock.Row> rowOf = new HashMap<>();
    private final Map<String, Cached> cache = new HashMap<>();
    private final Map<String, String> accountDay = new HashMap<>();
    private final Map<String, AccountOutcome> accounts = new HashMap<>();
    private final RecommendationConfig calibration;
    private final JsonNode insuranceMaximums;

    ReplaySelection(ReplayRun run, SeedEvaluation evaluation) {
        this.run = run;
        this.evaluation = evaluation;
        this.evaluator = new GroupEvaluator(run.inputs, run.policy, run.adapterRow, evaluation.groups, evaluation.rows,
                () -> PolicyClock.iso(run.clock.now()));
        evaluation.rows.forEach(row -> rowOf.put(row.orderUuid(), row));
        PolicyRead read = new PolicyRead(run.runId, run.inputs.manifest().get("startsAt").textValue(), run.policyVersion);
        this.calibration = new RecommendationConfig(ComparisonExperiments.assumption(run.policy, "employee.recommendation.v1", read).get("value"));
        this.insuranceMaximums = ComparisonExperiments.assumption(run.policy, "manual.context.v1", read).get("value")
                .get("insuranceMaximumByGrade");
    }

    /** The account projection for the employee at the run's current date; one read per employee per day. */
    AccountOutcome account(String employeeId) {
        String day = PolicyClock.iso(run.clock.now()).substring(0, 10);
        if (day.equals(accountDay.get(employeeId))) return accounts.get(employeeId);
        AccountOutcome outcome = run.account(employeeId);
        accountDay.put(employeeId, day);
        accounts.put(employeeId, outcome);
        return outcome;
    }

    /** The state, context version and group verdicts now; refuses like Node when the account is unavailable. */
    Browse browse(String employeeId) {
        AccountOutcome account = account(employeeId);
        if (!account.isOk()) throw refuse("unavailable", "browse-stock");
        String state = account.value().get("state").textValue();
        JsonNode context = account.value().get("contextVersion");
        String contextVersion = context == null || context.isNull() ? null : context.textValue();
        if (!"ready".equals(state)) return new Browse(state, contextVersion, Map.of());
        long at = run.clock.now().toEpochMilli();
        Cached cached = cache.get(employeeId);
        if (cached != null && cached.at() == at && java.util.Objects.equals(cached.browse().contextVersion(), contextVersion)) {
            return cached.browse();
        }
        Browse fresh = new Browse(state, contextVersion, evaluate(account.value(), run.employees.get(employeeId)));
        cache.put(employeeId, new Cached(at, fresh));
        return fresh;
    }

    private Map<String, Eligibility> evaluate(JsonNode account, JsonNode employee) {
        String id = employee.get("employeeId").textValue();
        String collection = employee.get("renewalAt").textValue().substring(0, 10);
        ObjectNode brief = JSON.objectNode();
        brief.put("schemaVersion", 1);
        brief.put("briefVersion", 1);
        brief.putObject("preferences");
        brief.putObject("essentials");
        brief.put("requiredBy", collection + "T23:59:59.999Z");
        ObjectNode outcome = evaluator.evaluate(employee, brief);
        if (!"ok".equals(ReplayRecords.text(outcome.get("status")))) {
            throw refuse(ReplayRecords.text(outcome.get("status")), "browse-stock");
        }
        String licence = licenceCode(account, id, collection);
        Map<String, Eligibility> out = new HashMap<>();
        for (JsonNode decision : outcome.get("value").get("decisions")) {
            ArrayNode blockers = ((ArrayNode) decision.get("blockers")).deepCopy();
            ArrayNode unknowns = ((ArrayNode) decision.get("unknowns")).deepCopy();
            if (licence != null) {
                if (licence.equals("licence-unconfirmed")) unknowns.addObject().put("code", licence);
                else blockers.addObject().put("code", licence);
            }
            JsonNode maximum = insuranceMaximums == null ? null : insuranceMaximums.get(employee.get("gradeId").textValue());
            JsonNode insurance = decision.get("snapshot").get("facts").get("insuranceGroup");
            boolean finiteMax = maximum != null && maximum.isNumber() && Double.isFinite(maximum.doubleValue());
            if (!finiteMax || !Gates.confirmedFact(insurance, calibration) || !insurance.get("value").isNumber()) {
                unknowns.addObject().put("code", "insurance-unconfirmed");
            } else if (insurance.get("value").doubleValue() > maximum.doubleValue()) {
                blockers.addObject().put("code", "insurance-grade-limit");
            }
            boolean eligible = blockers.isEmpty() && unknowns.isEmpty();
            ObjectNode terms = null;
            Instant validUntil = null;
            JsonNode source = decision.get("terms");
            if (eligible && source != null && source.isObject()) {
                terms = JSON.objectNode();
                terms.set("points", source.get("points"));
                terms.set("allowanceInputs", source.get("allowanceInputs"));
                terms.set("contribution", source.get("contribution"));
                ObjectNode provenance = terms.putObject("provenance");
                JsonNode from = source.get("provenance");
                provenance.set("sourceRef", from.get("sourceRef"));
                provenance.set("version", from.get("version"));
                provenance.set("assurance", from.get("assurance"));
                validUntil = Instant.ofEpochMilli(ComparisonValidation.parseInstant(source.get("validUntil").textValue()).getAsLong());
            }
            out.put(evaluation.groups.groupOf().get(decision.get("orderUuid").textValue()),
                    new Eligibility(eligible && terms != null, terms, validUntil));
        }
        return out;
    }

    // Licence validity at the requested collection date; null when it passes.
    private static String licenceCode(JsonNode account, String employeeId, String collection) {
        JsonNode licence = null;
        for (JsonNode driver : account.get("drivers")) {
            if (ReplayRecords.driverId(employeeId).equals(ReplayRecords.text(driver.get("driverId")))) licence = driver.get("licence");
        }
        JsonNode source = licence == null ? null : licence.get("source");
        boolean valid = source != null && source.isObject() && "synthetic".equals(ReplayRecords.text(source.get("mode")))
                && ReplayRecords.text(source.get("sourceRef")) != null && ReplayRecords.text(source.get("sourceVersion")) != null
                && ReplayRecords.text(source.get("schemaVersion")) != null
                && ComparisonValidation.parseInstant(ReplayRecords.text(source.get("effectiveFrom"))).isPresent()
                && ComparisonValidation.parseInstant(ReplayRecords.text(source.get("observedAt"))).isPresent();
        String from = licence == null ? null : ReplayRecords.text(licence.get("validFrom"));
        String until = licence == null ? null : ReplayRecords.text(licence.get("validUntil"));
        if (!valid || from == null || until == null || licence.get("categories") == null || !licence.get("categories").isArray()
                || ComparisonValidation.parseInstant(from + "T00:00:00.000Z").isEmpty()
                || ComparisonValidation.parseInstant(until + "T00:00:00.000Z").isEmpty()) return "licence-unconfirmed";
        boolean car = false;
        for (JsonNode category : licence.get("categories")) car |= "car".equals(ReplayRecords.text(category));
        return from.compareTo(collection) > 0 || until.compareTo(collection) < 0 || !car ? "licence-not-valid-at-collection" : null;
    }

    /** A claim input for a car the employee may take now, or null; the stock version is read by the caller. */
    ObjectNode claimInput(Browse browse, String orderUuid, long stockVersion) {
        Eligibility verdict = browse.groups().get(evaluation.groups.groupOf().get(orderUuid));
        if (verdict == null || !verdict.eligible()) return null;
        ObjectNode input = JSON.objectNode();
        input.put("orderUuid", orderUuid);
        input.put("expectedStockVersion", stockVersion);
        input.put("expectedDraftVersion", 1);
        input.put("expectedContextVersion", browse.contextVersion());
        input.put("expectedTermsDigest", ManualClaims.termsDigest(run.policyVersion, verdict.terms()));
        return input;
    }

    @Override
    public Claimant claimant(ClaimScope scope) {
        AccountOutcome account = account(scope.employeeId());
        if (!account.isOk() || account.value().get("contextVersion").isNull()) return new NoClaimant("manual-source-unavailable");
        return new Known(ReplayRecords.slotId(scope.employeeId()), account.value().get("contextVersion").textValue(), 1,
                ReplayRecords.driverId(scope.employeeId()), run.policyVersion);
    }

    @Override
    public Decision decide(ClaimScope scope, String orderUuid) {
        Browse browse = browse(scope.employeeId());
        ReplayStock.Row row = rowOf.get(orderUuid);
        Eligibility verdict = row == null ? null : browse.groups().get(evaluation.groups.groupOf().get(orderUuid));
        if (!"ready".equals(browse.state()) || verdict == null || !verdict.eligible()) return new NotEligible("not-eligible");
        ObjectNode facts = JSON.objectNode();
        facts.put("factsDigest", row.factsDigest());
        return new Eligible(row.configurationId(), facts, verdict.terms().deepCopy(), verdict.validUntil());
    }

    @Override
    public OrderDraft orderDraft(ClaimScope scope) {
        return new NoDecision("order-draft-not-built");
    }

    /** The accounts that can order; Node's open-time checks that every ready account has a permitted option. */
    void checkReady(String employeeId) {
        AccountOutcome outcome = account(employeeId);
        if (!outcome.isOk()) throw refuse("unavailable", "manual-account");
        JsonNode account = outcome.value();
        String state = account.get("state").textValue();
        if (List.of("ordering-closed", "not-yet-eligible").contains(state)) return;
        ReplayRecords.check("ready".equals(state), "manual-account-ready");
        JsonNode driver = null;
        for (JsonNode d : account.get("drivers")) if (ReplayRecords.driverId(employeeId).equals(ReplayRecords.text(d.get("driverId")))) driver = d;
        JsonNode choices = account.get("choices");
        String schemeId = run.employees.get(employeeId).get("schemeId").textValue();
        JsonNode option = null;
        for (JsonNode o : choices.get("contractOptions")) {
            if (option == null && ComparisonValidation.includes(o.get("schemeIds"), JSON.textNode(schemeId)) && driver != null
                    && ComparisonValidation.includes(o.get("driverKinds"), driver.get("kind"))) option = o;
        }
        JsonNode location = null;
        for (JsonNode l : choices.get("collectionLocations")) {
            if (location == null && option != null && ComparisonValidation.includes(l.get("contractOptionIds"), option.get("contractOptionId"))
                    && ComparisonValidation.includes(l.get("driverKinds"), driver.get("kind"))) location = l;
        }
        ReplayRecords.check(option != null && location != null && choices.get("brands").size() > 0, "manual-options");
    }

    /** Policy rows of this run's reads, for the outcome record. */
    PolicyResult read(String key) {
        return run.policy.getAssumption(key, new PolicyRead(run.runId, run.inputs.manifest().get("startsAt").textValue(), run.policyVersion));
    }
}
