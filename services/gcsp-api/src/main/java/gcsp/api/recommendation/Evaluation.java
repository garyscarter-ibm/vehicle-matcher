package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** evaluateScopedRecommendation from server/gcsp/recommendation/index.js: one evaluation of one employee context. */
final class Evaluation {

    /** The unsaved-draft side of a preview: the charging answer, base versions, metadata and the original brief. */
    record Preview(JsonNode charging, JsonNode baseBriefVersion, JsonNode baseDraftVersion, ObjectNode metadata, ObjectNode original) {}

    private record Candidate(JsonNode orderUuid, JsonNode configurationId, ObjectNode snapshot, JsonNode availability) {}

    private static final Pattern UUID = Pattern.compile(
            "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", Pattern.CASE_INSENSITIVE);
    private static final List<String> CONTEXT_KEYS = List.of("runId", "environmentId", "employeeId", "companyId", "schemeId",
            "gradeId", "policyVersion");
    private static final List<String> TYPED = List.of("currentCarRating", "sameAgain");
    private static final List<String> REFUSED_CODES = List.of("unknown-scheme", "unknown-company", "unknown-grade",
            "invalid-context", "run-mismatch");

    private Evaluation() {}

    static boolean text(String value) {
        return value != null && Js.text(Js.F.textNode(value));
    }

    static ObjectNode run(RecommendationSource provider, PolicyService policy, RecommendationClock time,
            RecommendationContext context, JsonNode request, Preview preview) {
        if (provider == null || policy == null || time == null) return Outcomes.unavailable("provider-not-configured");
        String[] values = {context.runId(), context.environmentId(), context.employeeId(), context.companyId(),
            context.schemeId(), context.gradeId(), context.policyVersion()};
        for (String value : values) {
            if (!text(value)) {
                return Outcomes.invalid("invalid-context", Outcomes.one("context", "The server must resolve a complete employee context."));
            }
        }
        try {
            return evaluate(provider, policy, time, context, request, preview);
        } catch (RuntimeException e) {
            return Outcomes.unavailable("employee-source-invalid");
        }
    }

    private static ObjectNode evaluate(RecommendationSource provider, PolicyService policy, RecommendationClock time,
            RecommendationContext context, JsonNode request, Preview preview) {
        JsonNode clock = time.now(context);
        if (Js.eqStr(Js.opt(clock, "status"), "stale-run")) return (ObjectNode) clock;
        JsonNode clockValue = Js.opt(clock, "value");
        if (!Js.eqStr(Js.opt(clock, "status"), "ok") || !Js.validInstant(Js.opt(clockValue, "now"))
                || !Js.text(Js.get(clockValue, "clockVersion"))) {
            return Outcomes.unavailable("clock-unavailable");
        }
        if (!Js.eqStr(clockValue.get("runId"), context.runId())) return Outcomes.refused();
        String now = Instants.iso(Instants.parse(clockValue.get("now")));
        PolicyContext policyContext = new PolicyContext(context.runId(), context.companyId(), context.schemeId(), context.gradeId());
        PolicyRead read = new PolicyRead(context.runId(), now, context.policyVersion());
        PolicyResult allowance = policy.getAllowance(policyContext, read);
        if (allowance.status().equals("invalid") && allowance.code() != null && REFUSED_CODES.contains(allowance.code())) {
            return allowance.body();
        }
        if (!allowance.ok()) return Outcomes.unavailable("allowance-unavailable");
        String policyVersion = allowance.policyVersion();
        List<PolicyResult> assumptionResults = new ArrayList<>();
        for (String key : List.of("employee.recommendation.v1", "brief.slider.minimum", "brief.slider.maximum",
                "eligibility.homeCharging.requiredForPlugIn")) {
            assumptionResults.add(policy.getAssumption(key, read));
        }
        for (PolicyResult row : assumptionResults) {
            if (!row.ok() || !same(row.policyVersion(), policyVersion)) return Outcomes.unavailable("policy-configuration-unavailable");
        }
        JsonNode calibration = assumptionResults.get(0).value().get("value");
        Slider slider = new Slider(number(assumptionResults.get(1).value().get("value")),
                number(assumptionResults.get(2).value().get("value")));
        JsonNode charging = assumptionResults.get(3).value().get("value");
        RecommendationConfig config = new RecommendationConfig(calibration == null ? null : calibration.deepCopy());
        if (!config.valid(slider) || charging == null || !charging.isBoolean()) return Outcomes.unavailable("policy-configuration-invalid");

        ObjectNode typed = Js.obj();
        JsonNode content = request;
        if (preview == null && request != null && request.isObject()) {
            ObjectNode kept = Js.obj();
            for (Map.Entry<String, JsonNode> e : Js.entries(request)) if (!TYPED.contains(e.getKey())) kept.set(e.getKey(), e.getValue());
            content = kept;
            for (String key : TYPED) if (request.has(key)) typed.set(key, request.get(key));
        } else if (preview != null) {
            for (String key : TYPED) if (preview.original().get(key) != null) typed.set(key, preview.original().get(key));
        }
        ArrayNode typedErrors = Js.arr();
        for (String key : TYPED) {
            if (!typed.has(key)) continue;
            boolean valid = key.equals("currentCarRating") ? CurrentCar.ratingValid(typed.get(key)) : CurrentCar.sameAgainValid(typed.get(key));
            if (!valid) typedErrors.add(new Js.B().s("field", key).s("reason", "Unsupported or invalid current-car feedback.").build());
        }
        ArrayNode errors = preview != null ? BriefRules.validateBriefContent(request, config, slider)
                : BriefRules.validateBrief(content, config, slider);
        if (preview != null) {
            PolicyResult lifecycle = policy.getAssumption("brief.lifecycle.v1", read);
            JsonNode lifecycleCharging = lifecycle.ok() ? Js.opt(Js.opt(lifecycle.value(), "value"), "charging") : null;
            JsonNode values = Js.opt(lifecycleCharging, "values");
            if (!lifecycle.ok() || !same(lifecycle.policyVersion(), policyVersion) || values == null || !values.isArray()) {
                return Outcomes.unavailable("policy-configuration-unavailable");
            }
            assumptionResults.add(lifecycle);
            ObjectNode stripped = Js.obj();
            for (Map.Entry<String, JsonNode> e : Js.entries(preview.original())) {
                if (!e.getKey().equals("currentCarFeedback") && !TYPED.contains(e.getKey())) stripped.set(e.getKey(), e.getValue());
            }
            ObjectNode essentials = Js.obj();
            for (Map.Entry<String, JsonNode> e : Js.entries(config.read("essentials"))) essentials.set(e.getKey(), e.getValue());
            essentials.set("charging", lifecycleCharging);
            ObjectNode withCharging = config.json().deepCopy();
            withCharging.set("essentials", essentials);
            errors = BriefRules.validateBriefContent(stripped, new RecommendationConfig(withCharging), slider);
        }
        if (errors.size() > 0 || typedErrors.size() > 0) {
            ArrayNode all = Js.arr();
            all.addAll(errors);
            all.addAll(typedErrors);
            return Outcomes.invalid("invalid-brief", all);
        }
        ObjectNode brief = content.deepCopy();
        if (preview != null) promote(brief);
        JsonNode briefVersion = preview != null
                ? Js.truthy(preview.baseBriefVersion()) ? preview.baseBriefVersion() : Js.F.nullNode()
                : Js.orNull(brief.get("briefVersion"));

        JsonNode provided = provider.resolve(context);
        String providedStatus = Js.eqStr(Js.opt(provided, "status"), "stale-run") ? "stale-run"
                : Js.eqStr(Js.opt(provided, "status"), "forbidden") ? "forbidden" : null;
        if (providedStatus != null) return (ObjectNode) provided;
        if (!Js.eqStr(Js.opt(provided, "status"), "ok")) return Outcomes.unavailable("employee-source-unavailable");
        JsonNode raw = provided.get("value");
        JsonNode source = raw == null ? null : raw.deepCopy();
        String[] expected = {context.runId(), context.environmentId(), context.employeeId()};
        String[] names = {"runId", "environmentId", "employeeId"};
        for (int i = 0; i < names.length; i++) if (!Js.eqStr(Js.opt(source, names[i]), expected[i])) return Outcomes.refused();
        List<Candidate> candidates = validateSource(source);
        ObjectNode employeeFacts = (ObjectNode) source.get("employeeFacts");
        if (preview != null && !Gates.unselectedPracticalAnswer(preview.charging())) {
            employeeFacts.set("charging", previewCharging(preview, now));
        }

        Feedback.Fb fb = null;
        ObjectNode feedbackRecord = null;
        if (typed.size() > 0) {
            PolicyResult row = policy.getAssumption(CurrentCar.FEEDBACK_KEY, read);
            JsonNode rules = row.ok() ? Js.opt(row.value(), "value") : null;
            if (!row.ok() || !same(row.policyVersion(), policyVersion) || !CurrentCar.policyValid(rules)) {
                JsonNode on = Js.opt(typed.get("sameAgain"), "on");
                JsonNode rated = Js.opt(typed.get("currentCarRating"), "value");
                if (Js.eqBool(on, true) || rated != null && !rated.isNull()) return Outcomes.unavailable("feedback-policy-unavailable");
                feedbackRecord = new Js.B().s("applied", false).s("reason", "feedback-policy-unavailable").build();
            } else {
                assumptionResults.add(row);
                JsonNode baseline = CurrentCar.baselineOf(Js.get(source, "currentCar"));
                JsonNode rating = typed.has("currentCarRating") ? typed.get("currentCarRating") : new Js.B().s("value", Js.F.nullNode()).build();
                if (baseline == null && (Js.eqBool(Js.opt(typed.get("sameAgain"), "on"), true)
                        || CurrentCar.ratingClass(Js.get(rating, "value"), Js.get(rules, "rating")).equals("positive"))) {
                    return Outcomes.unavailable("feedback-baseline-unavailable");
                }
                boolean usableRating = matches(typed.get("currentCarRating"), baseline);
                boolean usableSame = matches(typed.get("sameAgain"), baseline);
                boolean mismatch = false;
                for (String key : TYPED) if (typed.has(key) && !matches(typed.get(key), baseline)) mismatch = true;
                String inert = baseline == null ? "feedback-baseline-unavailable" : mismatch ? "feedback-contract-mismatch" : "feedback-neutral";
                boolean sameOn = usableSame && Js.eqBool(typed.get("sameAgain").get("on"), true);
                String identity = CurrentCar.FEEDBACK_KEY + "@" + row.policyVersion()
                        + (baseline == null ? "" : "+" + Js.toStr(Js.at(baseline, "source", "sourceVersion")));
                fb = new Feedback.Fb(rules, row.policyVersion(), baseline, rating, usableRating, usableSame, inert, sameOn, identity);
            }
        }
        JsonNode providerEssentials = employeeFacts.get("essentials");
        if (providerEssentials != null) {
            ObjectNode wrap = new Js.B().s("schemaVersion", 1).s("preferences", Js.obj()).s("essentials", providerEssentials).build();
            if (BriefRules.validateBriefContent(wrap, config, slider).size() > 0) return Outcomes.unavailable("employee-facts-invalid");
        }

        ArrayNode decisions = Js.arr();
        List<JsonNode> decisionList = new ArrayList<>();
        for (Candidate candidate : candidates) {
            ObjectNode car = Js.obj();
            for (Map.Entry<String, JsonNode> e : Js.entries(candidate.snapshot().get("facts"))) {
                if (Js.eqStr(e.getValue().get("status"), "known")) car.set(e.getKey(), e.getValue().get("value"));
            }
            car.set("configurationId", candidate.configurationId());
            PolicyResult eligibility = policy.getEligibility(policyContext, car, read);
            PolicyResult cost = policy.getPointsCost(policyContext, car, read);
            if (!eligibility.ok() || !(cost.ok() || cost.status().equals("not-found"))
                    || !same(eligibility.policyVersion(), policyVersion) || !same(cost.policyVersion(), policyVersion)) {
                return Outcomes.unavailable("candidate-policy-unavailable");
            }
            ObjectNode decision = decide(candidate, eligibility, cost, allowance, employeeFacts, providerEssentials, brief, preview,
                    briefVersion, source, clockValue, assumptionResults, fb, feedbackRecord, config, slider, now, charging.booleanValue());
            decisions.add(decision);
            decisionList.add(decision);
        }
        List<JsonNode> ranked = Ranking.rank(decisionList, config);
        ArrayNode rankedList = Js.arr();
        ranked.forEach(rankedList::add);
        ArrayNode ordered = Js.arr();
        if (preview != null) {
            ordered.addAll(rankedList);
            for (JsonNode d : decisionList) if (!Js.eqStr(d.get("gateStatus"), "eligible")) ordered.add(d);
        } else {
            ordered = decisions;
        }
        ArrayNode recommendations = Js.arr();
        int shown = (int) Math.min(ranked.size(), config.json().get("displayLimit").doubleValue());
        for (int i = 0; i < shown; i++) recommendations.add(ranked.get(i));
        Js.B versions = new Js.B().s("brief", briefVersion).s("facts", source.get("factsVersion")).s("policy", policyVersion)
                .s("stock", source.get("stockVersion")).s("clock", clockValue.get("clockVersion"));
        if (fb != null) versions.s("feedback", fb.identity());
        ObjectNode value = Js.obj();
        value.put("scenarioId", "employee-scheme-demo-v1");
        value.put("runId", context.runId());
        if (preview != null) {
            value.set("preview", preview.metadata());
            value.set("brief", preview.original());
        }
        value.put("state", decisions.size() == 0 ? "no-stock" : ranked.isEmpty() ? "no-viable-stock" : "recommendations");
        value.put("evaluatedAt", now);
        value.set("versions", versions.build());
        value.set("decisions", ordered);
        value.set("recommendations", recommendations);
        value.put("eligibleCount", ranked.size());
        JsonNode ranking = config.read("ranking");
        if (Js.truthy(ranking)) value.set("ranking", ranking);
        return Outcomes.result("ok", new Js.B().s("value", value).build());
    }

    private static boolean same(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    private static double number(JsonNode n) {
        return n != null && n.isNumber() ? n.doubleValue() : Double.NaN;
    }

    private static boolean matches(JsonNode entry, JsonNode baseline) {
        return entry != null && baseline != null && Js.strictEq(Js.get(entry, "contractId"), baseline.get("contractId"));
    }

    private static void promote(ObjectNode brief) {
        for (JsonNode p : Js.get(brief, "preferences")) {
            if (Js.eqStr(p.get("source"), "employee") && Js.eqStr(p.get("valueState"), "draft")) ((ObjectNode) p).put("valueState", "confirmed");
            if (Js.eqStr(p.get("source"), "employee") && Js.eqStr(p.get("importanceState"), "draft")) ((ObjectNode) p).put("importanceState", "confirmed");
        }
        for (JsonNode e : Js.get(brief, "essentials")) {
            if (Js.eqStr(e.get("source"), "employee") && Js.eqStr(e.get("state"), "draft")) ((ObjectNode) e).put("state", "confirmed");
        }
    }

    private static ObjectNode previewCharging(Preview preview, String now) {
        JsonNode answer = preview.charging();
        JsonNode answered = Js.truthy(answer) ? answer.get("value") : null;
        boolean known = Js.truthy(answer) && !(answered != null && answered.isNull())
                && (Js.eqStr(answer.get("state"), "confirmed")
                        || Js.eqStr(answer.get("state"), "draft") && Js.eqStr(answer.get("source"), "employee"));
        ObjectNode provenance = new Js.B().s("sourceRef", "employee-preview:charging")
                .s("version", "draft:" + Js.toStr(preview.baseDraftVersion())).s("observedAt", now)
                .s("assurance", "synthetic-scenario").build();
        return new Js.B().s("status", known ? "known" : "unknown").s("value", known ? answered : Js.F.nullNode())
                .s("provenance", provenance).s("preview", new Js.B().s("kind", "unsaved-draft").s("approved", false).build()).build();
    }

    private static List<Candidate> validateSource(JsonNode source) {
        if (!Js.text(Js.opt(source, "factsVersion")) || !Js.text(source.get("stockVersion"))
                || !Js.truthy(source.get("employeeFacts")) || !source.get("employeeFacts").isObject()
                || source.get("stock") == null || !source.get("stock").isArray()) {
            throw new RecommendationFault("Invalid provider facts");
        }
        Set<String> seen = new HashSet<>();
        List<Candidate> out = new ArrayList<>();
        for (JsonNode row : source.get("stock")) {
            JsonNode orderUuid = Js.get(row, "orderUuid");
            if (orderUuid == null || !orderUuid.isTextual() || !UUID.matcher(orderUuid.textValue()).matches()
                    || !Js.text(row.get("configurationId")) || seen.contains(orderUuid.textValue())
                    || !Js.truthy(row.get("availability")) || !Js.text(Js.get(row.get("availability"), "version"))) {
                throw new RecommendationFault("Invalid exact stock");
            }
            seen.add(orderUuid.textValue());
            ObjectNode snapshot = Vehicles.snapshot(row.get("snapshot"));
            if (!Js.eqStr(snapshot.get("identityKind"), "exact-stock")
                    || !Js.strictEq(Js.get(snapshot.get("sourceKeys"), "stockId"), orderUuid) || snapshot.has("vin")) {
                throw new RecommendationFault("Invalid stock identity");
            }
            out.add(new Candidate(orderUuid, row.get("configurationId"), snapshot, row.get("availability").deepCopy()));
        }
        return out;
    }

    private static ObjectNode empty() {
        return new Js.B().s("score", Js.F.nullNode()).s("components", Js.arr()).s("reasons", Js.arr()).s("tradeOffs", Js.arr())
                .s("unknowns", Js.arr()).build();
    }

    private static void gate(ArrayNode blockers, ArrayNode unknowns, ArrayNode reasons, JsonNode blocks, JsonNode unk, JsonNode why) {
        blockers.addAll((ArrayNode) blocks);
        unknowns.addAll((ArrayNode) unk);
        reasons.addAll((ArrayNode) why);
    }

    private static ObjectNode decide(Candidate candidate, PolicyResult eligibility, PolicyResult cost, PolicyResult allowance,
            ObjectNode employeeFacts, JsonNode providerEssentials, ObjectNode brief, Preview preview, JsonNode briefVersion,
            JsonNode source, JsonNode clockValue, List<PolicyResult> assumptionResults, Feedback.Fb fb, ObjectNode feedbackRecord,
            RecommendationConfig config, Slider slider, String now, boolean chargingRequired) {
        ArrayNode blockers = Js.arr();
        ArrayNode unknowns = Js.arr();
        ArrayNode reasons = Js.arr();
        if (providerEssentials == null) unknowns.add(new Js.B().s("code", "employee-essentials-unconfirmed").build());
        if (config.driverEligibilityRequired()) {
            JsonNode driver = employeeFacts.get("driverEligible");
            if (!Gates.confirmedFact(driver, config) || !Js.isBool(driver.get("value"))) {
                unknowns.add(new Js.B().s("code", "driver-unconfirmed").s("fact", Js.orNull(driver)).build());
            } else {
                boolean eligibleDriver = driver.get("value").booleanValue();
                (eligibleDriver ? reasons : blockers).add(new Js.B().s("code", eligibleDriver ? "driver-eligible" : "driver-ineligible")
                        .s("fact", driver).build());
            }
        }
        JsonNode eligible = eligibility.value();
        String state = Js.get(eligible, "state").textValue();
        if ("ineligible".equals(state)) {
            blockers.add(new Js.B().s("code", "policy-exclude").s("ruleIds", eligible.get("ruleIds")).build());
        } else if (!"eligible".equals(state)) {
            unknowns.add(new Js.B().s("code", "eligibility-unconfirmed").s("reasons", eligible.get("reasons")).build());
        } else {
            reasons.add(new Js.B().s("code", "policy-include").s("ruleIds", eligible.get("ruleIds")).build());
        }
        ObjectNode terms = null;
        JsonNode priced = cost.ok() ? cost.value() : null;
        if (!cost.ok()) {
            unknowns.add(new Js.B().s("code", "points-unavailable").s("configurationId", candidate.configurationId()).build());
        } else {
            JsonNode allowed = allowance.value();
            boolean affordable = Js.rel(allowed.get("monthlyPoints"), priced.get("monthlyPoints")) >= 0;
            (affordable ? reasons : blockers).add(new Js.B().s("code", affordable ? "allowance-sufficient" : "allowance-exceeded")
                    .s("allowance", allowed.get("monthlyPoints")).s("monthlyPoints", priced.get("monthlyPoints"))
                    .s("unit", "points/month").build());
            String version = allowance.policyVersion();
            String termsVersion = version + ":" + Js.toStr(priced.get("priceEntryId")) + ":" + Js.toStr(allowed.get("allowanceId")) + ":" + now;
            String until = Instants.iso(Instants.parse(now) + config.termValiditySeconds() * 1000);
            terms = Vehicles.employeeTerms(termsVersion, priced.get("monthlyPoints"), allowed.get("monthlyPoints"), now, until,
                    priced.get("source"), version, now, Js.eqStr(priced.get("status"), "assumed") ? "synthetic-scenario" : "derived");
        }
        ObjectNode providerGates = gates(Gates.evaluateEssentials(candidate.snapshot(),
                new Js.B().s("essentials", providerEssentials == null ? Js.obj() : providerEssentials).build(), config, false));
        for (String kind : List.of("blockers", "unknowns", "reasons")) {
            for (JsonNode entry : providerGates.get(kind)) ((ObjectNode) entry).put("authority", "employee-provider");
        }
        gate(blockers, unknowns, reasons, providerGates.get("blockers"), providerGates.get("unknowns"), providerGates.get("reasons"));
        ObjectNode briefGates = gates(Gates.evaluateEssentials(candidate.snapshot(), brief, config, true));
        gate(blockers, unknowns, reasons, briefGates.get("blockers"), briefGates.get("unknowns"), briefGates.get("reasons"));
        ObjectNode timing = Timing.gates(candidate.availability(), employeeFacts, brief, now, config);
        gate(blockers, unknowns, reasons, timing.get("blockers"), timing.get("unknowns"), timing.get("reasons"));
        ObjectNode chargingGates = gates(Gates.chargingGates(candidate.snapshot(), employeeFacts, config, chargingRequired));
        gate(blockers, unknowns, reasons, chargingGates.get("blockers"), chargingGates.get("unknowns"), chargingGates.get("reasons"));

        String gateStatus = blockers.size() > 0 ? "ineligible" : unknowns.size() > 0 ? "needs-confirmation" : "eligible";
        ObjectNode scores = gateStatus.equals("eligible")
                ? PreferenceScoring.score(candidate.snapshot(), brief, employeeFacts, config, slider) : empty();
        JsonNode feedback = feedbackRecord;
        if (fb != null) {
            Feedback.Judged judged = Feedback.judge(fb, !gateStatus.equals("eligible"), candidate.snapshot(), candidate.configurationId(),
                    scores, brief, employeeFacts, config, slider);
            feedback = judged.record();
            if (judged.omit() != null) {
                blockers.add(judged.omit());
                gateStatus = "ineligible";
                scores = empty();
            } else {
                reasons.addAll(judged.reasons());
                if (fb.sameOn() && fb.baseline() != null) scores = empty();
            }
        }
        ArrayNode allReasons = Js.arr();
        allReasons.addAll(reasons);
        allReasons.addAll((ArrayNode) scores.get("reasons"));
        ArrayNode allUnknowns = Js.arr();
        allUnknowns.addAll(unknowns);
        allUnknowns.addAll((ArrayNode) scores.get("unknowns"));
        Js.B versions = new Js.B().s("brief", briefVersion).s("facts", source.get("factsVersion")).s("policy", allowance.policyVersion())
                .s("stock", source.get("stockVersion")).s("snapshot", candidate.snapshot().get("snapshotVersion"))
                .s("terms", terms == null ? Js.F.nullNode() : terms.get("termsVersion")).s("clock", clockValue.get("clockVersion"))
                .s("availability", candidate.availability().get("version"));
        if (fb != null) versions.s("feedback", fb.identity());
        ArrayNode assumptions = Js.arr();
        for (PolicyResult row : assumptionResults) assumptions.add(row.value());
        ObjectNode evidence = new Js.B().s("eligibility", eligible).s("allowance", allowance.value())
                .s("points", priced == null ? Js.F.nullNode() : priced).s("assumptions", assumptions)
                .s("availability", candidate.availability()).build();
        Js.B decision = new Js.B().s("candidateKey", candidate.snapshot().get("candidateKey")).s("orderUuid", candidate.orderUuid())
                .s("configurationId", candidate.configurationId()).s("gateStatus", gateStatus).s("suitable", gateStatus.equals("eligible"))
                .s("evaluatedAt", now).s("score", scores.get("score")).s("components", scores.get("components"))
                .s("reasons", allReasons).s("tradeOffs", scores.get("tradeOffs")).s("blockers", blockers).s("unknowns", allUnknowns)
                .s("snapshot", candidate.snapshot()).s("terms", terms == null ? Js.F.nullNode() : terms)
                .s("brief", preview != null ? preview.original() : brief);
        if (preview != null) decision.s("preview", preview.metadata());
        decision.s("employeeFacts", employeeFacts);
        if (Js.truthy(feedback)) decision.s("feedback", feedback);
        return decision.s("versions", versions.build()).s("evidence", evidence).build();
    }

    private static ObjectNode gates(Gates.Result r) {
        return r.toJson();
    }

    /** timingGates from server/gcsp/recommendation/index.js. */
    static final class Timing {

        private Timing() {}

        static ObjectNode gates(JsonNode available, JsonNode employeeFacts, JsonNode brief, String now, RecommendationConfig config) {
            ArrayNode blockers = Js.arr();
            ArrayNode unknowns = Js.arr();
            ArrayNode reasons = Js.arr();
            if (!Js.includes(config.availabilityStates(), available.get("state"))) throw new RecommendationFault("Unsupported stock availability");
            if (Js.eqStr(available.get("state"), "unknown")) {
                unknowns.add(new Js.B().s("code", "availability-unconfirmed").s("availability", available).build());
            } else if (!Js.eqStr(available.get("state"), "available")) {
                blockers.add(new Js.B().s("code", "not-available").s("availability", available).build());
            }
            for (String key : List.of("availableFrom", "availableUntil")) {
                if (!Js.validInstant(available.get(key))) {
                    unknowns.add(new Js.B().s("code", "availability-date-unconfirmed").s("field", key).build());
                }
            }
            double from = Instants.parse(available.get("availableFrom"));
            double until = Instants.parse(available.get("availableUntil"));
            double at = Instants.parse(now);
            if (Double.isFinite(from) && Double.isFinite(until) && from >= until) throw new RecommendationFault("Invalid availability interval");
            JsonNode required = employeeFacts.get("requiredBy");
            if (!Gates.confirmedFact(required, config) || !Js.validInstant(required.get("value"))) {
                unknowns.add(new Js.B().s("code", "required-by-unconfirmed").s("fact", Js.orNull(required)).build());
            } else {
                JsonNode briefRequired = Js.get(brief, "requiredBy");
                double deadline = Math.min(Instants.parse(required.get("value")),
                        Js.truthy(briefRequired) ? Instants.parse(briefRequired) : Double.POSITIVE_INFINITY);
                if (from > deadline || at > deadline) {
                    blockers.add(new Js.B().s("code", "required-by").s("requiredBy", Instants.iso(deadline))
                            .s("availableFrom", available.get("availableFrom")).build());
                } else {
                    reasons.add(new Js.B().s("code", "required-by-met").s("requiredBy", Instants.iso(deadline)).build());
                }
            }
            if (at >= until) blockers.add(new Js.B().s("code", "availability-expired").s("availableUntil", available.get("availableUntil")).build());
            if (from > at) blockers.add(new Js.B().s("code", "not-yet-available").s("availableFrom", available.get("availableFrom")).build());
            return new Js.B().s("blockers", blockers).s("unknowns", unknowns).s("reasons", reasons).build();
        }
    }
}
