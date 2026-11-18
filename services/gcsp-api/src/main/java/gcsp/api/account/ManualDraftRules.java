package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountService.Prepared;
import gcsp.api.persistence.Canonical;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Node's manual draft choice rules (ManualContextService.#validate and its helpers), messages verbatim. */
final class ManualDraftRules {

    static final List<String> FIELDS = List.of("mode", "oldContractId", "slotId", "schemeId", "driverId",
            "contractOptionId", "requestedCollectionDate", "collectionLocationId", "brand", "contact",
            "expectedReturnMileage", "specialRequirements");
    static final List<String> INTENT_FIELDS = List.of("mode", "oldContractId", "slotId", "schemeId");
    static final List<String> DEPENDENCY_FIELDS = List.of("mode", "oldContractId", "slotId", "schemeId", "driverId",
            "contractOptionId", "requestedCollectionDate", "collectionLocationId", "brand");

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String NOT_SPACE = "[^\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff@]";
    private static final Pattern PHONE = Pattern.compile("[+]?[0-9 ()-]{7,30}");
    private static final Pattern EMAIL = Pattern.compile(NOT_SPACE + "+@" + NOT_SPACE + "+\\." + NOT_SPACE + "+");
    private static final Pattern CONTROL = Pattern.compile("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]");

    private ManualDraftRules() {}

    /** Either a ready-made invalid body, or the accepted draft stage and the chosen contract option. */
    record Validated(ObjectNode invalid, boolean intent, JsonNode contract) {}

    static boolean only(JsonNode v, List<String> keys) {
        if (!Js.object(v)) return false;
        for (var it = v.fieldNames(); it.hasNext();) if (!keys.contains(it.next())) return false;
        return true;
    }

    static boolean revision(JsonNode v) {
        return Js.safeInt(v) && v.decimalValue().signum() >= 0;
    }

    static ObjectNode invalid(String field, String reason) {
        return invalid(field, reason, "invalid-manual-draft");
    }

    static ObjectNode invalid(String field, String reason, String code) {
        ObjectNode body = F.objectNode().put("status", "invalid").put("code", code);
        body.putArray("reasons").addObject().put("field", field).put("reason", reason);
        body.set("view", view("validation", true, "correct-fields"));
        return body;
    }

    static ObjectNode view(String state, boolean editable, String action) {
        return F.objectNode().put("state", state).put("editable", editable).put("supportOwner", "employee")
                .put("action", action);
    }

    static boolean validContact(JsonNode c) {
        if (!only(c, List.of("phone", "email"))) return false;
        JsonNode phone = c.get("phone");
        JsonNode email = c.get("email");
        return phone != null && phone.isTextual() && PHONE.matcher(phone.textValue()).matches()
                && email != null && email.isTextual() && email.textValue().length() <= 254
                && EMAIL.matcher(email.textValue()).matches();
    }

    static boolean isIntent(JsonNode choices) {
        return only(choices, INTENT_FIELDS) && INTENT_FIELDS.stream().allMatch(choices::has);
    }

    static Validated validate(AccountScope ctx, JsonNode choices, Prepared p) {
        if (!only(choices, FIELDS) || !(Js.eqStr(choices.get("mode"), "new") || Js.eqStr(choices.get("mode"), "replacement"))) {
            return bad(invalid("choices", "Supply registered manual choices and new or replacement mode."));
        }
        JsonNode slotId = choices.get("slotId");
        if (!Js.eqStr(choices.get("schemeId"), ctx.schemeId()) || !Js.eqStr(slotId, ctx.entitlementSlotId())
                || !Js.strictEq(slotId, p.slot.get("entitlementSlotId"))) {
            return bad(invalid("choices", "Choose the server-owned scheme and entitled vehicle slot.", "authority-override"));
        }
        boolean replacement = Js.eqStr(choices.get("mode"), "replacement");
        if (replacement && (p.contract == null || !Js.strictEq(choices.get("oldContractId"), p.contract.get("contractId")))
                || !replacement && (p.contract != null || !Js.nullish(choices.get("oldContractId")))) {
            return bad(invalid("oldContractId", "Keep the current contract separate; use the permitted Order or Replace action."));
        }
        if (isIntent(choices)) return new Validated(null, true, null);
        JsonNode driver = find(p.drivers.get("drivers"), d -> Js.strictEq(d.get("driverId"), choices.get("driverId")));
        if (driver == null) return bad(invalid("driverId", "Choose who will drive the car."));
        JsonNode rules = p.rules;
        JsonNode contract = find(rules.get("contractOptions"), c -> Js.strictEq(c.get("contractOptionId"), choices.get("contractOptionId"))
                && Js.includes(c.get("schemeIds"), ctx.schemeId()) && Js.includes(c.get("driverKinds"), driver.get("kind")));
        if (contract == null) return bad(invalid("contractOptionId", "Choose a contract length and annual mileage."));
        if (!Js.includes(rules.get("brands"), choices.get("brand"))) return bad(invalid("brand", "Choose a brand."));
        JsonNode location = find(rules.get("locations"), l -> Js.strictEq(l.get("locationId"), choices.get("collectionLocationId"))
                && Js.includes(l.get("contractOptionIds"), contract.get("contractOptionId"))
                && Js.includes(l.get("driverKinds"), driver.get("kind")));
        if (location == null) return bad(invalid("collectionLocationId", "Choose where to collect the car."));
        JsonNode date = choices.get("requestedCollectionDate");
        if (!Js.calendarDate(date)) return bad(invalid("requestedCollectionDate", "Enter the date you want to collect the car."));
        String day = date.textValue();
        if (!AccountService.collectionDates(p, null).contains(day) || AccountService.closedOn(location, day)) {
            return bad(invalid("requestedCollectionDate", "Choose a collection date inside your collection window."));
        }
        JsonNode licence = Js.opt(driver, "licence");
        JsonNode source = Js.opt(licence, "source");
        if (!AccountService.sourceValid(source)
                || Js.epochMillis(source.get("effectiveFrom").textValue()) > Js.epochMillis(p.now)
                || !Js.calendarDate(Js.opt(licence, "validFrom")) || !Js.calendarDate(Js.opt(licence, "validUntil"))
                || !Js.array(Js.opt(licence, "categories"))) {
            return bad(invalid("driverId", "Licence facts need confirmation. Contact driver support.", "licence-unconfirmed"));
        }
        String from = licence.get("validFrom").textValue();
        String until = licence.get("validUntil").textValue();
        if (!Js.includes(licence.get("categories"), "car") || from.compareTo(until) > 0 || from.compareTo(day) > 0
                || until.compareTo(day) < 0) {
            return bad(invalid("driverId", "This licence is not valid for a car at the requested collection date. Contact driver support.",
                    "licence-not-valid-at-collection"));
        }
        JsonNode points = Js.opt(p.allowance, "monthlyPoints");
        if (points == null || !points.isNumber() || points.decimalValue().signum() < 0
                || !Js.eqStr(Js.opt(p.allowance, "unit"), "points/month")
                || !(Js.eqStr(Js.opt(p.allowance, "status"), "assumed") || Js.eqStr(Js.opt(p.allowance, "status"), "verified"))
                || !Js.eqStr(Js.opt(p.allowance, "schemeId"), ctx.schemeId())
                || !Js.eqStr(Js.opt(p.allowance, "companyId"), ctx.companyId())
                || !Js.eqStr(Js.opt(p.allowance, "gradeId"), ctx.gradeId())) {
            return bad(invalid("allowance", "Monthly points allowance needs confirmation. Contact scheme support.", "allowance-unconfirmed"));
        }
        if (!validContact(choices.get("contact"))) return bad(invalid("contact", "Enter a phone number and an email address."));
        JsonNode mileage = choices.get("expectedReturnMileage");
        if (!replacement && !Js.nullish(mileage)) {
            return bad(invalid("expectedReturnMileage", "Mileage applies only when you replace a car."));
        }
        if (replacement && !revision(mileage)) {
            return bad(invalid("expectedReturnMileage", "Enter the mileage your current car will have when you return it."));
        }
        long maxMileage = rules.get("maximumReturnMileage").decimalValue().longValueExact();
        if (replacement && mileage.decimalValue().compareTo(java.math.BigDecimal.valueOf(maxMileage)) > 0) {
            return bad(invalid("expectedReturnMileage",
                    String.format(Locale.UK, "Enter a mileage of up to %,d miles.", maxMileage)));
        }
        long maxText = rules.get("maximumSpecialRequirements").decimalValue().longValueExact();
        JsonNode special = choices.get("specialRequirements");
        if (special == null || !special.isTextual() || special.textValue().length() > maxText
                || CONTROL.matcher(special.textValue()).find()) {
            return bad(invalid("specialRequirements",
                    "Use at most " + maxText + " characters. Requests do not change released stock."));
        }
        return new Validated(null, false, contract);
    }

    /** The next saved version, carrying the previous draft's selection and quote forward unless a dependency changed. */
    static ObjectNode nextValue(AccountScope ctx, String subject, Prepared p, JsonNode choices, Validated validated,
            JsonNode previous, long version) {
        com.fasterxml.jackson.databind.node.ArrayNode changes = F.arrayNode();
        if (previous != null) {
            for (String key : DEPENDENCY_FIELDS) {
                if (!Canonical.json(orNull(previous.get("choices").get(key))).equals(Canonical.json(orNull(choices.get(key))))) {
                    changes.add(key);
                }
            }
            if (!Js.eqStr(previous.get("contextVersion"), p.contextVersion)) changes.add("context");
        }
        boolean changed = changes.size() > 0;
        com.fasterxml.jackson.databind.node.ArrayNode invalidations = F.arrayNode();
        if (changed) {
            invalidations.addAll(changes);
            invalidations.add("selection").add("quote").add("eligible-stock");
        }
        long generation = previous != null && previous.has("dependentGeneration")
                ? previous.get("dependentGeneration").longValue() : 0;
        ObjectNode v = F.objectNode();
        v.put("schemaVersion", 1).put("runId", ctx.runId()).put("employeeId", ctx.employeeId());
        v.put("draftVersion", version + 1);
        if (version > 0) v.put("previousDraftVersion", version);
        else v.putNull("previousDraftVersion");
        v.put("contextVersion", p.contextVersion);
        v.set("choices", choices.deepCopy());
        v.put("draftStage", validated.intent() ? "intent" : "complete");
        v.set("currentContract", p.contract != null ? p.contract : F.nullNode());
        v.set("renewalId", orNull(p.slot.get("renewalId")));
        v.set("entitlementSlotId", p.slot.get("entitlementSlotId"));
        v.set("contract", validated.contract() != null ? validated.contract() : F.nullNode());
        v.set("sources", AccountService.versions(p));
        v.put("policyVersion", ctx.policyVersion());
        v.set("invalidations", invalidations);
        v.put("dependentGeneration", generation + (changed ? 1 : 0));
        v.set("selection", changed || previous == null ? F.nullNode() : orNull(previous.get("selection")));
        v.set("quote", changed || previous == null ? F.nullNode() : orNull(previous.get("quote")));
        v.put("savedAt", p.now).put("savedBy", subject);
        v.set("view", view("draft", true, validated.intent() ? "choose-order-options" : "browse-stock"));
        return v;
    }

    private static JsonNode orNull(JsonNode n) {
        return Js.nullish(n) ? F.nullNode() : n;
    }

    private static Validated bad(ObjectNode invalid) {
        return new Validated(invalid, false, null);
    }

    private interface Match {
        boolean test(JsonNode n);
    }

    private static JsonNode find(JsonNode array, Match m) {
        for (JsonNode n : array) if (m.test(n)) return n;
        return null;
    }
}
