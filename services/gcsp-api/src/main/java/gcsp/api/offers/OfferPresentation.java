package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.SourceResult;
import gcsp.api.identity.Principal;
import gcsp.api.offers.OfferRecords.OfferRecord;
import gcsp.api.ordering.OrderingResult;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.OrderingServiceHolder;
import gcsp.api.ordering.OrderingTerms;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.List;

/** Public HTTP presentation over an already owned offer. No command or provider write runs during this read. */
final class OfferPresentation {
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private OfferPresentation() {}

    static ObjectNode of(Principal p, OfferRecord record, OfferView view, AccountRecordsPort accounts,
            PolicyService policy, OrderingServiceHolder ordering) {
        var pinned = record.projection();
        if (pinned == null || pinned.runId() == null || pinned.slotId() == null) return null;
        ObjectNode out = FollowupComparison.offer(view, pinned.runId(), pinned.clockVersion(),
                "declined".equals(view.state()) ? pinned.decisionId() : null, pinned.quote(), pinned.orderNumber());
        if (out == null) return null;
        OrderingScope scope = new OrderingScope(p.environmentId(), pinned.runId(), record.employeeId(),
                pinned.slotId(), p.policyVersion());
        if (view.availableActions().contains("accept")) {
            ObjectNode handoff = handoff(scope, view, accounts, policy);
            if (handoff == null) return null;
            out.set("handoff", handoff);
            if (handoff.path("blocker").isNull()) {
                out.putArray("availableActions").add("accept").add("decline");
            }
        } else if ("accepted".equals(view.state())) {
            if (ordering == null || ordering.service().isEmpty()) return null;
            OrderingResult result = ordering.service().orElseThrow().read(scope);
            JsonNode value = result instanceof OrderingResult.Ok ok ? ok.value()
                    : result instanceof OrderingResult.Pending pending ? pending.value() : null;
            if (result instanceof OrderingResult.Unavailable) return null;
            if (value != null && "buddy-offer".equals(value.path("selection").path("sourceType").asText())
                    && record.holdId().equals(value.path("selection").path("holdId").asText())
                    && record.quoteId().equals(value.path("selection").path("quoteId").asText())
                    && record.orderUuid().equals(value.path("selection").path("orderUuid").asText())) {
                ObjectNode progress = F.objectNode().put("schemaVersion", 1);
                for (String key : List.of("selectionState", "approved", "current", "stages")) {
                    JsonNode item = value.path("progress").get(key);
                    if (item == null) return null;
                    progress.set(key, item.deepCopy());
                }
                progress.set("orderReference", value.path("orderReference").isTextual()
                        ? value.get("orderReference") : F.nullNode());
                progress.set("orderNumber", out.path("quote").get("orderNumber"));
                out.set("selection", progress);
            }
        }
        return out;
    }

    private static ObjectNode handoff(OrderingScope scope, OfferView view, AccountRecordsPort accounts,
            PolicyService policy) {
        if (accounts == null || policy == null) return null;
        AccountScope who = new AccountScope(scope.environmentId(), scope.runId(), scope.employeeId(), null,
                List.of("employee"), null, null, null, scope.entitlementSlotId(), scope.policyVersion());
        SourceResult contract = accounts.readEmployeeContract(who);
        SourceResult drivers = accounts.readDrivers(who);
        if (!contract.isOk() || !drivers.isOk()) return null;
        JsonNode contact = contract.value().path("account").path("contact");
        JsonNode driver = BuddyOfferConversion.employeeDriver(drivers.value().path("drivers"), scope.employeeId());
        JsonNode current = BuddyOfferConversion.currentContract(contract.value().path("contracts"), scope.entitlementSlotId());
        String mode = current == null ? "new" : "replacement";
        boolean contactOk = BuddyOfferConversion.validContact(contact);
        OrderingTerms.TermsRead read = new OrderingTerms(policy, ctx -> view.serverNow()).terms(scope, view.serverNow());
        JsonNode terms = read instanceof OrderingTerms.TermsOk ok ? ok.value() : F.objectNode();
        String blocker = !contactOk ? "contact-required"
                : !BuddyOfferConversion.driverOk(driver, view.serverNow().toString().substring(0, 10)) ? "driver-review-required"
                : current != null && !BuddyOfferConversion.returnOk(current) ? "return-data-required"
                : !(read instanceof OrderingTerms.TermsOk) ? "ordering-terms-unavailable" : null;
        JsonNode maximum = F.nullNode();
        if (current != null) {
            PolicyResult rules = policy.getAssumption("manual.context.v1", new PolicyRead(scope.runId(),
                    PolicyClock.iso(view.serverNow()), scope.policyVersion()));
            if (rules.ok() && scope.policyVersion().equals(rules.policyVersion()) && rules.value() != null) {
                maximum = rules.value().path("value").path("maximumReturnMileage");
            }
            if ((!maximum.isIntegralNumber() || !maximum.canConvertToLong() || maximum.longValue() <= 0) && blocker == null) {
                blocker = "ordering-terms-unavailable";
            }
        }
        ObjectNode out = F.objectNode().put("fictional", true).put("mode", mode).put("blocker", blocker);
        for (String key : List.of("termsVersion", "termsDigest")) out.set(key, nullable(terms.get(key)));
        out.set("wording", nullable(terms.path("wordingByMode").get(mode) == null
                ? terms.get("wording") : terms.path("wordingByMode").get(mode)));
        var declarations = out.putArray("declarations");
        for (JsonNode declaration : terms.path("declarations")) {
            if ("all".equals(declaration.path("appliesTo").asText()) || mode.equals(declaration.path("appliesTo").asText())) {
                declarations.addObject().setAll(select(declaration, "id", "label"));
            }
        }
        out.set("contact", contactOk ? select(contact, "phone", "email") : F.nullNode());
        if (driver == null) out.putNull("driver");
        else {
            ObjectNode d = select(driver, "name", "kind");
            JsonNode licence = driver.path("licence");
            if (!licence.isObject()) d.putNull("licence");
            else {
                ObjectNode l = select(licence, "displayNumber", "validFrom", "validUntil");
                l.set("categories", licence.path("categories").isArray() ? licence.get("categories").deepCopy() : F.arrayNode());
                d.set("licence", l);
            }
            out.set("driver", d);
        }
        out.putObject("documentSource").put("terms", "ordering.terms.v1")
                .setAll(select(terms, "termsVersion"));
        ((ObjectNode) out.get("documentSource")).set("recordSource", nullable(contract.value().path("source").get("sourceRef")));
        if (current != null && maximum.isIntegralNumber() && maximum.canConvertToLong() && maximum.longValue() > 0) {
            out.putObject("returnMileage").put("maximum", maximum.longValue()).put("unit", "mi");
        } else out.putNull("returnMileage");
        if (current == null) out.putNull("returnCar");
        else {
            ObjectNode car = select(current, "model", "contractEndDate");
            car.set("currentOdometer", current.path("currentOdometer").isObject()
                    ? select(current.get("currentOdometer"), "value", "unit") : F.nullNode());
            car.putNull("expectedReturnMileage");
            out.set("returnCar", car);
        }
        return out;
    }

    private static JsonNode nullable(JsonNode value) {
        return value == null || value.isMissingNode() ? F.nullNode() : value.deepCopy();
    }

    private static ObjectNode select(JsonNode source, String... keys) {
        ObjectNode out = F.objectNode();
        for (String key : keys) out.set(key, nullable(source.get(key)));
        return out;
    }
}
