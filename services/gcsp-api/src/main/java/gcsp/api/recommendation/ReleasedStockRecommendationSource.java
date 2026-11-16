package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountOutcome;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.AccountService;
import gcsp.api.account.SourceResult;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import gcsp.api.supply.ReleasedCar;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The runtime provider of server/gcsp/runtime.js with releasedStock of manual-context/ports.js: the employee's account
 * facts plus every released car visible to them. Failures are Node outcomes; nothing is invented.
 */
public final class ReleasedStockRecommendationSource implements RecommendationSource {

    /** The keyset page size; a request reads floor(N / PAGE) + 1 pages of N released cars. */
    public static final int PAGE = 500;

    private final AccountService account;
    private final AccountRecordsPort records;
    private final StockPages stock;
    private final VehicleEvidencePort evidence;
    private final RecommendationClock clock;

    public ReleasedStockRecommendationSource(AccountService account, AccountRecordsPort records, StockPages stock,
            VehicleEvidencePort evidence, RecommendationClock clock) {
        this.account = account;
        this.records = records;
        this.stock = stock;
        this.evidence = evidence;
        this.clock = clock;
    }

    @Override
    public JsonNode resolve(RecommendationContext context) {
        if (!context.roles().contains("employee")) return Outcomes.forbidden();
        JsonNode time = clock.now(context);
        if (!Js.eqStr(Js.opt(time, "status"), "ok")) return time;
        String now = text(Js.opt(Js.opt(time, "value"), "now"));
        if (now == null) return unavailable();
        AccountScope scope = new AccountScope(context.environmentId(), context.runId(), context.employeeId(), null,
                context.roles(), context.companyId(), context.schemeId(), context.gradeId(), context.entitlementSlotId(),
                context.policyVersion());
        AccountOutcome current = account.readAccount(scope);
        if (!current.isOk()) return unavailable();
        SourceResult driverRead = records.readDrivers(scope);
        if (!driverRead.isOk()) return unavailable();
        JsonNode drivers = driverRead.value();
        JsonNode versions = current.value().get("versions");
        if (!scoped(drivers, context) || versions == null || !Js.strictEq(drivers.get("recordSetId"), versions.get("recordSetId"))
                || !Js.strictEq(drivers.get("repositoryVersion"), versions.get("employee"))
                || !Js.object(drivers.get("employeeFacts")) || drivers.get("drivers") == null || !drivers.get("drivers").isArray()
                || !Js.truthy(drivers.get("source")) || !Js.truthy(drivers.get("recordSetId"))) return unavailable();
        RunContext run = new RunContext(context.environmentId(), context.runId(), context.employeeId());
        ReleasedStockView released = read(run, context);
        if (released == null) return unavailable();
        JsonNode currentContract = current.value().get("currentContract");
        JsonNode contractId = currentContract == null ? null : currentContract.get("contractId");
        ObjectNode baseline = CurrentCarBaseline.project(versions.get("employeeContract"), current.value().get("contracts"),
                contractId, context, now);
        JsonNode driverId = currentContract == null ? null : currentContract.get("driverId");
        JsonNode driver = null;
        for (JsonNode d : drivers.get("drivers")) if (driverId != null && Js.strictEq(d.get("driverId"), driverId)) {
            driver = d;
            break;
        }
        if (driver == null) for (JsonNode d : drivers.get("drivers")) if (Js.eqStr(d.get("kind"), "employee")) {
            driver = d;
            break;
        }
        ObjectNode facts = ((ObjectNode) drivers.get("employeeFacts")).deepCopy();
        if (driver != null && driver.get("eligible") != null) facts.set("driverEligible", driver.get("eligible"));
        ObjectNode digestInput = Js.obj();
        digestInput.set("driver", drivers.get("source"));
        digestInput.set("recordSetId", drivers.get("recordSetId"));
        digestInput.set("repositoryVersion", Js.orNull(drivers.get("repositoryVersion")));
        Js.B value = new Js.B().s("runId", context.runId()).s("environmentId", context.environmentId())
                .s("employeeId", context.employeeId()).s("factsVersion", Canonical.digest(digestInput))
                .s("stockVersion", released.version()).s("employeeFacts", facts).s("stock", released.cars());
        if (baseline != null) value.s("currentCar", baseline);
        return new Js.B().s("status", "ok").s("value", value.build()).s("contractVersion", Outcomes.CONTRACT_VERSION).build();
    }

    private record ReleasedStockView(String version, ArrayNode cars) {}

    /** Every released car, paged to exhaustion; null when the source or its visibility records are unusable. */
    private ReleasedStockView read(RunContext run, RecommendationContext context) {
        List<ReleasedCar> all = new ArrayList<>();
        try {
            String after = null;
            while (true) {
                List<ReleasedCar> page = stock.page(run, after, PAGE);
                all.addAll(page);
                if (page.size() < PAGE) break;
                after = page.get(page.size() - 1).orderUuid();
            }
        } catch (SQLException | RuntimeException e) {
            return null;
        }
        List<String> versions = new ArrayList<>();
        ArrayNode cars = Js.arr();
        for (ReleasedCar car : all) {
            JsonNode visibility = car.attributes().get("visibility");
            if (!visibilityValid(visibility)) return null;
            versions.add(car.orderUuid() + ":" + car.version());
            if (!visible(visibility, context)) continue;
            Optional<JsonNode> snapshot = evidence.snapshot(run, car.orderUuid(), car.configurationId(), car.attributes().get("facts"));
            if (snapshot.isEmpty()) return null;
            JsonNode release = car.attributes().get("release");
            JsonNode listed = release == null ? null : release.get("availability");
            ObjectNode availability = listed != null && listed.isObject() ? ((ObjectNode) listed).deepCopy() : Js.obj();
            if (car.occupied()) availability.put("state", "unavailable");
            cars.add(new Js.B().s("orderUuid", car.orderUuid()).s("orderNumber", car.attributes().get("orderNumber"))
                    .s("configurationId", car.configurationId()).s("snapshot", snapshot.get()).s("availability", availability).build());
        }
        versions.sort(null);
        return new ReleasedStockView("stock:" + String.join("|", versions), cars);
    }

    private static boolean visibilityValid(JsonNode v) {
        return Js.object(v) && v.get("companyIds") != null && v.get("companyIds").isArray() && v.get("schemeIds") != null
                && v.get("schemeIds").isArray() && v.get("employeeIds") != null
                && (v.get("employeeIds").isNull() || v.get("employeeIds").isArray());
    }

    private static boolean visible(JsonNode v, RecommendationContext c) {
        return Js.includes(v.get("companyIds"), c.companyId()) && Js.includes(v.get("schemeIds"), c.schemeId())
                && (v.get("employeeIds").isNull() || Js.includes(v.get("employeeIds"), c.employeeId()));
    }

    private static boolean scoped(JsonNode v, RecommendationContext c) {
        return Js.eqStr(Js.opt(v, "runId"), c.runId()) && Js.eqStr(Js.opt(v, "environmentId"), c.environmentId())
                && Js.eqStr(Js.opt(v, "employeeId"), c.employeeId());
    }

    private static String text(JsonNode n) {
        return n != null && n.isTextual() ? n.textValue() : null;
    }

    private static ObjectNode unavailable() {
        return Outcomes.result("unavailable", new Js.B().s("reason", "The service is unavailable.").s("retryable", true).build());
    }
}
