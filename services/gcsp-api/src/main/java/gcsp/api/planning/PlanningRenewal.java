package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** Port of server/gcsp/predict/plan/renewal.js: a supplied contract end date as UTC end of day, as in F112. */
public final class PlanningRenewal {

    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");

    private PlanningRenewal() {
    }

    /**
     * The renewal instant 'yyyy-MM-ddT23:59:59.999Z', or null when it is ambiguous, missing or not a real day.
     * Throws where Node throws a TypeError: no employee, non-array contracts, or a null contract entry.
     */
    public static String renewalInstant(JsonNode employee) {
        if (employee == null || employee.isNull() || employee.isMissingNode()) {
            throw new IllegalArgumentException("employee");
        }
        JsonNode contract = Js.get(employee, "contract");
        JsonNode contracts = Js.get(Js.get(contract, "manualContext"), "contracts");
        if (contracts != null && !contracts.isNull() && !contracts.isArray()) {
            throw new IllegalArgumentException("contracts");
        }
        List<JsonNode> current = new ArrayList<>();
        for (JsonNode c : Js.items(contracts)) {
            if (c == null || c.isNull()) {
                throw new IllegalArgumentException("contract");
            }
            JsonNode status = Js.get(c, "status");
            if (status != null && status.isTextual() && "current".equals(status.textValue())) {
                current.add(c);
            }
        }
        if (current.size() > 1) {
            return null;
        }
        JsonNode date = Js.get(current.isEmpty() ? contract : current.get(0), "contractEndDate");
        if (date == null || !date.isTextual() || !DATE.matcher(date.textValue()).matches()) {
            return null;
        }
        String end = date.textValue() + "T23:59:59.999Z";
        return JsTime.parse(end) != null ? end : null;
    }
}
