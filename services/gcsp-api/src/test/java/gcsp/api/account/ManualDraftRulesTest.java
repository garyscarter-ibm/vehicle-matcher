package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountService.Prepared;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

/** Node's #validate and the saved value's versioning, over port doubles built from the paula golden. */
class ManualDraftRulesTest {

    private static final com.fasterxml.jackson.databind.node.JsonNodeFactory F = GoldenFixture.JSON.getNodeFactory();

    static ObjectNode complete() {
        ObjectNode c = F.objectNode();
        c.put("mode", "replacement").put("oldContractId", "current:employee-paula").put("slotId", "slot-paula")
                .put("schemeId", "choices-fs-uk").put("driverId", "driver:employee-paula")
                .put("contractOptionId", "twelve-month-12000").put("requestedCollectionDate", "2026-11-12")
                .put("collectionLocationId", "demo-collection-centre").put("brand", "bmw")
                .put("expectedReturnMileage", 20000).put("specialRequirements", "");
        c.putObject("contact").put("phone", "01632 960000").put("email", "paula.mason@gcsp-demo.com");
        return c;
    }

    static ObjectNode intent() {
        ObjectNode c = F.objectNode();
        c.put("mode", "replacement").put("oldContractId", "current:employee-paula").put("slotId", "slot-paula")
                .put("schemeId", "choices-fs-uk");
        return c;
    }

    private static Prepared prepared(GoldenFixture fx) {
        Prepared p = fx.service().prepare(fx.scope);
        assertNull(p.error);
        assertEquals("ready", p.state);
        return p;
    }

    private static ManualDraftRules.Validated check(GoldenFixture fx, ObjectNode choices) {
        return ManualDraftRules.validate(fx.scope, choices, prepared(fx));
    }

    private static void rejected(ManualDraftRules.Validated v, String code, String field, String reason) {
        assertNotNull(v.invalid());
        assertEquals("invalid", v.invalid().get("status").asText());
        assertEquals(code, v.invalid().get("code").asText());
        JsonNode r = v.invalid().get("reasons").get(0);
        assertEquals(field, r.get("field").asText());
        assertEquals(reason, r.get("reason").asText());
        assertEquals("validation", v.invalid().get("view").get("state").asText());
        assertTrue(v.invalid().get("view").get("editable").asBoolean());
        assertEquals("employee", v.invalid().get("view").get("supportOwner").asText());
        assertEquals("correct-fields", v.invalid().get("view").get("action").asText());
    }

    private static void rejectedWith(Consumer<ObjectNode> edit, String code, String field, String reason) {
        ObjectNode c = complete();
        edit.accept(c);
        rejected(check(new GoldenFixture("paula"), c), code, field, reason);
    }

    @Test
    void completeChoicesAreAcceptedWithTheChosenContract() {
        ManualDraftRules.Validated v = check(new GoldenFixture("paula"), complete());
        assertNull(v.invalid());
        assertFalse(v.intent());
        assertEquals("twelve-month-12000", v.contract().get("contractOptionId").asText());
    }

    @Test
    void intentOnlyChoicesAreAnIntentDraft() {
        ManualDraftRules.Validated v = check(new GoldenFixture("paula"), intent());
        assertNull(v.invalid());
        assertTrue(v.intent());
        assertNull(v.contract());
    }

    @Test
    void unregisteredFieldsOrModeAreRefused() {
        String reason = "Supply registered manual choices and new or replacement mode.";
        rejectedWith(c -> c.put("extra", 1), "invalid-manual-draft", "choices", reason);
        rejectedWith(c -> c.put("mode", "other"), "invalid-manual-draft", "choices", reason);
    }

    @Test
    void serverOwnedSchemeAndSlotCannotBeOverridden() {
        String reason = "Choose the server-owned scheme and entitled vehicle slot.";
        rejectedWith(c -> c.put("schemeId", "other"), "authority-override", "choices", reason);
        rejectedWith(c -> c.put("slotId", "slot-other"), "authority-override", "choices", reason);
    }

    @Test
    void contractRelationshipMustMatchTheMode() {
        String reason = "Keep the current contract separate; use the permitted Order or Replace action.";
        rejectedWith(c -> c.put("oldContractId", "current:someone-else"), "invalid-manual-draft", "oldContractId", reason);
        rejectedWith(c -> c.put("mode", "new").putNull("oldContractId"), "invalid-manual-draft", "oldContractId", reason);
    }

    @Test
    void driverContractLocationBrandAndDateAreChecked() {
        rejectedWith(c -> c.put("driverId", "nobody"), "invalid-manual-draft", "driverId", "Choose who will drive the car.");
        rejectedWith(c -> c.put("contractOptionId", "nope"), "invalid-manual-draft", "contractOptionId",
                "Choose a contract length and annual mileage.");
        rejectedWith(c -> c.put("brand", "ford"), "invalid-manual-draft", "brand", "Choose a brand.");
        rejectedWith(c -> c.put("collectionLocationId", "nowhere"), "invalid-manual-draft", "collectionLocationId",
                "Choose where to collect the car.");
        rejectedWith(c -> c.put("requestedCollectionDate", "soon"), "invalid-manual-draft", "requestedCollectionDate",
                "Enter the date you want to collect the car.");
        rejectedWith(c -> c.put("requestedCollectionDate", "2026-11-06"), "invalid-manual-draft", "requestedCollectionDate",
                "Choose a collection date inside your collection window.");
    }

    @Test
    void closedLocationDateIsOutsideTheWindow() {
        GoldenFixture fx = new GoldenFixture("paula");
        ((com.fasterxml.jackson.databind.node.ArrayNode) fx.rulesPayload().get("locations").get(0).get("closedDates")).add("2026-11-12");
        rejected(check(fx, complete()), "invalid-manual-draft", "requestedCollectionDate",
                "Choose a collection date inside your collection window.");
    }

    @Test
    void licenceFactsAreConfirmedAndValidAtCollection() {
        GoldenFixture unconfirmed = new GoldenFixture("paula");
        ((ObjectNode) unconfirmed.manual().withArray("drivers").get(0).get("licence")).remove("validUntil");
        rejected(check(unconfirmed, complete()), "licence-unconfirmed", "driverId",
                "Licence facts need confirmation. Contact driver support.");
        GoldenFixture expired = new GoldenFixture("paula");
        ((ObjectNode) expired.manual().withArray("drivers").get(0).get("licence")).put("validUntil", "2026-11-10");
        rejected(check(expired, complete()), "licence-not-valid-at-collection", "driverId",
                "This licence is not valid for a car at the requested collection date. Contact driver support.");
        GoldenFixture noCar = new GoldenFixture("paula");
        ((ObjectNode) noCar.manual().withArray("drivers").get(0).get("licence")).putArray("categories").add("bus");
        rejected(check(noCar, complete()), "licence-not-valid-at-collection", "driverId",
                "This licence is not valid for a car at the requested collection date. Contact driver support.");
    }

    @Test
    void unconfirmedAllowanceIsRefused() {
        GoldenFixture fx = new GoldenFixture("paula");
        ((ObjectNode) fx.allowance.value()).put("unit", "points/week");
        rejected(check(fx, complete()), "allowance-unconfirmed", "allowance",
                "Monthly points allowance needs confirmation. Contact scheme support.");
    }

    @Test
    void contactMileageAndRequirementsAreChecked() {
        String contact = "Enter a phone number and an email address.";
        rejectedWith(c -> ((ObjectNode) c.get("contact")).put("phone", "abc"), "invalid-manual-draft", "contact", contact);
        rejectedWith(c -> ((ObjectNode) c.get("contact")).put("email", "nobody"), "invalid-manual-draft", "contact", contact);
        rejectedWith(c -> c.remove("contact"), "invalid-manual-draft", "contact", contact);
        rejectedWith(c -> c.putNull("expectedReturnMileage"), "invalid-manual-draft", "expectedReturnMileage",
                "Enter the mileage your current car will have when you return it.");
        rejectedWith(c -> c.put("expectedReturnMileage", -1), "invalid-manual-draft", "expectedReturnMileage",
                "Enter the mileage your current car will have when you return it.");
        rejectedWith(c -> c.put("expectedReturnMileage", 500001), "invalid-manual-draft", "expectedReturnMileage",
                "Enter a mileage of up to 500,000 miles.");
        rejectedWith(c -> c.put("specialRequirements", "x".repeat(501)), "invalid-manual-draft", "specialRequirements",
                "Use at most 500 characters. Requests do not change released stock.");
        rejectedWith(c -> c.put("specialRequirements", "bad\u0007"), "invalid-manual-draft", "specialRequirements",
                "Use at most 500 characters. Requests do not change released stock.");
        rejectedWith(c -> c.remove("specialRequirements"), "invalid-manual-draft", "specialRequirements",
                "Use at most 500 characters. Requests do not change released stock.");
    }

    @Test
    void newModeTakesNoMileageAndNoOldContract() {
        GoldenFixture fx = new GoldenFixture("paula");
        ((ObjectNode) fx.input.get("slots").get(0)).remove("contractId");
        fx.manual().putArray("contracts");
        ObjectNode c = complete();
        c.put("mode", "new").putNull("oldContractId").putNull("expectedReturnMileage");
        ManualDraftRules.Validated ok = ManualDraftRules.validate(fx.scope, c, prepared(fx));
        assertNull(ok.invalid());
        c.put("expectedReturnMileage", 5);
        rejected(ManualDraftRules.validate(fx.scope, c, prepared(fx)), "invalid-manual-draft", "expectedReturnMileage",
                "Mileage applies only when you replace a car.");
    }

    @Test
    void firstSaveStartsAtVersionOneWithNoInvalidations() {
        GoldenFixture fx = new GoldenFixture("paula");
        Prepared p = prepared(fx);
        ManualDraftRules.Validated v = ManualDraftRules.validate(fx.scope, complete(), p);
        ObjectNode value = ManualDraftRules.nextValue(fx.scope, "sub-paula", p, complete(), v, null, 0);
        assertEquals(1, value.get("draftVersion").asInt());
        assertTrue(value.get("previousDraftVersion").isNull());
        assertEquals("complete", value.get("draftStage").asText());
        assertEquals(0, value.get("dependentGeneration").asInt());
        assertTrue(value.get("invalidations").isEmpty());
        assertTrue(value.get("selection").isNull());
        assertTrue(value.get("quote").isNull());
        assertEquals("sub-paula", value.get("savedBy").asText());
        assertEquals(fx.now, value.get("savedAt").asText());
        assertEquals("slot-paula", value.get("entitlementSlotId").asText());
        assertEquals("renewal:employee-paula", value.get("renewalId").asText());
        assertEquals("current:employee-paula", value.get("currentContract").get("contractId").asText());
        assertEquals("gcsp-policy-v1", value.get("policyVersion").asText());
        assertEquals(p.contextVersion, value.get("contextVersion").asText());
        assertEquals("browse-stock", value.get("view").get("action").asText());
        assertEquals(3, value.get("sources").get("employee").asInt());
        assertEquals(2, value.get("sources").get("slot").asInt());
        assertEquals(java.util.List.of("schemaVersion", "runId", "employeeId", "draftVersion", "previousDraftVersion",
                "contextVersion", "choices", "draftStage", "currentContract", "renewalId", "entitlementSlotId", "contract",
                "sources", "policyVersion", "invalidations", "dependentGeneration", "selection", "quote", "savedAt", "savedBy",
                "view"), fieldNames(value));
    }

    private static java.util.List<String> fieldNames(ObjectNode n) {
        java.util.List<String> names = new java.util.ArrayList<>();
        n.fieldNames().forEachRemaining(names::add);
        return names;
    }

    @Test
    void intentDraftIsStagedAsIntent() {
        GoldenFixture fx = new GoldenFixture("paula");
        Prepared p = prepared(fx);
        ManualDraftRules.Validated v = ManualDraftRules.validate(fx.scope, intent(), p);
        ObjectNode value = ManualDraftRules.nextValue(fx.scope, "sub-paula", p, intent(), v, null, 0);
        assertEquals("intent", value.get("draftStage").asText());
        assertTrue(value.get("contract").isNull());
        assertEquals("choose-order-options", value.get("view").get("action").asText());
    }

    @Test
    void changedDependencyInvalidatesAndKeepsNothingForward() {
        GoldenFixture fx = new GoldenFixture("paula");
        Prepared p = prepared(fx);
        ObjectNode first = ManualDraftRules.nextValue(fx.scope, "sub-paula", p, complete(),
                ManualDraftRules.validate(fx.scope, complete(), p), null, 0);
        first.putObject("selection").put("carId", "c1");
        first.putObject("quote").put("points", 1);
        ObjectNode changed = complete();
        changed.put("brand", "bmw").put("requestedCollectionDate", "2026-11-13");
        ObjectNode second = ManualDraftRules.nextValue(fx.scope, "sub-paula", p, changed,
                ManualDraftRules.validate(fx.scope, changed, p), first, 1);
        assertEquals(2, second.get("draftVersion").asInt());
        assertEquals(1, second.get("previousDraftVersion").asInt());
        assertEquals(1, second.get("dependentGeneration").asInt());
        assertEquals("[\"requestedCollectionDate\",\"selection\",\"quote\",\"eligible-stock\"]", second.get("invalidations").toString());
        assertTrue(second.get("selection").isNull());
        assertTrue(second.get("quote").isNull());
    }

    @Test
    void unchangedDependenciesCarrySelectionAndQuoteForward() {
        GoldenFixture fx = new GoldenFixture("paula");
        Prepared p = prepared(fx);
        ObjectNode first = ManualDraftRules.nextValue(fx.scope, "sub-paula", p, complete(),
                ManualDraftRules.validate(fx.scope, complete(), p), null, 0);
        first.putObject("selection").put("carId", "c1");
        first.putObject("quote").put("points", 1);
        ObjectNode edited = complete();
        edited.put("specialRequirements", "ground floor");
        ObjectNode second = ManualDraftRules.nextValue(fx.scope, "sub-paula", p, edited,
                ManualDraftRules.validate(fx.scope, edited, p), first, 1);
        assertEquals(0, second.get("dependentGeneration").asInt());
        assertTrue(second.get("invalidations").isEmpty());
        assertEquals("c1", second.get("selection").get("carId").asText());
        assertEquals(1, second.get("quote").get("points").asInt());
    }

    @Test
    void contextChangeSinceThePreviousDraftInvalidates() {
        GoldenFixture fx = new GoldenFixture("paula");
        Prepared p = prepared(fx);
        ObjectNode first = ManualDraftRules.nextValue(fx.scope, "sub-paula", p, complete(),
                ManualDraftRules.validate(fx.scope, complete(), p), null, 0);
        first.put("contextVersion", "old");
        ObjectNode second = ManualDraftRules.nextValue(fx.scope, "sub-paula", p, complete(),
                ManualDraftRules.validate(fx.scope, complete(), p), first, 1);
        assertEquals("[\"context\",\"selection\",\"quote\",\"eligible-stock\"]", second.get("invalidations").toString());
        assertEquals(1, second.get("dependentGeneration").asInt());
    }

    @Test
    void afterADiscardNothingCarriesForwardButTheCounterContinues() {
        GoldenFixture fx = new GoldenFixture("paula");
        Prepared p = prepared(fx);
        ObjectNode value = ManualDraftRules.nextValue(fx.scope, "sub-paula", p, complete(),
                ManualDraftRules.validate(fx.scope, complete(), p), null, 2);
        assertEquals(3, value.get("draftVersion").asInt());
        assertEquals(2, value.get("previousDraftVersion").asInt());
        assertEquals(0, value.get("dependentGeneration").asInt());
        assertTrue(value.get("invalidations").isEmpty());
    }
}
