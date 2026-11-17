package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.regex.Pattern;

/** Review-details input rules, a port of server/gcsp/manual-review/validation.js with its reason texts verbatim. */
final class ReviewValidation {

    /** JavaScript's \s, so blank and email checks agree with Node on Unicode spaces. */
    private static final String WS = "\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
    private static final Pattern BLANK = Pattern.compile("[" + WS + "]*");
    private static final Pattern PHONE = Pattern.compile("\\+?[0-9 ()-]{7,30}");
    private static final Pattern EMAIL = Pattern.compile("[^" + WS + "@]+@[^" + WS + "@]+\\.[^" + WS + "@]+");
    private static final Pattern CONTROL = Pattern.compile("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]");
    private static final long MAX_SAFE = 9_007_199_254_740_991L;
    private static final List<String> COMMAND_KEYS = List.of("commandId", "holdId", "quoteId", "expectedHoldVersion",
            "expectedDraftVersion", "expectedReviewDetailsVersion", "details");
    private static final List<String> DETAIL_KEYS = List.of("contact", "expectedReturnMileage", "specialRequirements");

    private ReviewValidation() {}

    /** The positive limits that bound the details, from policy manual.context.v1. */
    record Constraints(long maximumSpecialRequirements, long maximumReturnMileage, JsonNode provenance) {}

    private static final Pattern INSTANT =
            Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})");
    private static final Pattern DAY = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

    /** The Node validInstant rule: an ISO instant with a real calendar day and a valid time. */
    static boolean validInstant(String v) {
        if (v == null || !INSTANT.matcher(v).matches()) return false;
        try {
            java.time.LocalDate.parse(v.substring(0, 10));
        } catch (java.time.DateTimeException e) {
            return false;
        }
        return Integer.parseInt(v.substring(11, 13)) < 24 && Integer.parseInt(v.substring(14, 16)) < 60
                && Integer.parseInt(v.substring(17, 19)) < 60;
    }

    static boolean validDay(String v) {
        return v != null && DAY.matcher(v).matches();
    }

    static boolean object(JsonNode n) {
        return n != null && n.isObject();
    }

    static boolean only(JsonNode v, List<String> keys) {
        if (!object(v)) return false;
        var names = v.fieldNames();
        while (names.hasNext()) if (!keys.contains(names.next())) return false;
        return true;
    }

    static boolean blank(String s) {
        return BLANK.matcher(s).matches();
    }

    static boolean identifier(JsonNode v) {
        return v != null && v.isTextual() && !blank(v.textValue()) && v.textValue().length() <= 100;
    }

    /** Number.isSafeInteger: a JSON number with an integral value inside the 53-bit range, so 5.0 counts. */
    static boolean safeInteger(JsonNode v) {
        if (v == null || !v.isNumber()) return false;
        if (v.isIntegralNumber()) return v.canConvertToLong() && Math.abs(v.longValue()) <= MAX_SAFE;
        double d = v.doubleValue();
        return Double.isFinite(d) && d == Math.rint(d) && Math.abs(d) <= MAX_SAFE;
    }

    static boolean revision(JsonNode v) {
        return safeInteger(v) && v.longValue() >= 0;
    }

    static boolean positiveSafe(JsonNode v) {
        return safeInteger(v) && v.longValue() > 0;
    }

    static ReviewResult validateCommand(JsonNode input) {
        if (!only(input, COMMAND_KEYS)) return ReviewResult.invalid("command", "Use only the documented review fields.");
        for (String f : List.of("commandId", "holdId", "quoteId")) {
            if (!identifier(input.get(f))) {
                return ReviewResult.invalid(f, "Supply a nonempty identifier of at most 100 characters.");
            }
        }
        for (String f : List.of("expectedHoldVersion", "expectedDraftVersion", "expectedReviewDetailsVersion")) {
            JsonNode v = input.get(f);
            if (!revision(v) || !f.equals("expectedReviewDetailsVersion") && v.longValue() == 0) {
                return ReviewResult.invalid(f, "Supply the current integer revision.");
            }
        }
        return null;
    }

    static ReviewResult validateDetails(JsonNode details, String mode, Constraints limits) {
        if (!only(details, DETAIL_KEYS)) return ReviewResult.invalid("details", "Use only the documented detail fields.");
        JsonNode contact = details.get("contact");
        if (!only(contact, List.of("phone", "email"))) return ReviewResult.invalid("contact", "Supply only phone and email.");
        JsonNode phone = contact.get("phone");
        if (phone == null || !phone.isTextual() || !PHONE.matcher(phone.textValue()).matches()) {
            return ReviewResult.invalid("contact.phone", "Supply a contact telephone.");
        }
        JsonNode email = contact.get("email");
        if (email == null || !email.isTextual() || email.textValue().length() > 254
                || !EMAIL.matcher(email.textValue()).matches()) {
            return ReviewResult.invalid("contact.email", "Supply a contact email address.");
        }
        JsonNode miles = details.get("expectedReturnMileage");
        boolean given = miles != null && !miles.isNull();
        boolean replacement = "replacement".equals(mode);
        if (replacement && (!safeInteger(miles) || miles.longValue() < 0 || miles.longValue() > limits.maximumReturnMileage())
                || "new".equals(mode) && given) {
            return ReviewResult.invalid("expectedReturnMileage", replacement
                    ? "Supply returning-car mileage from 0 to " + limits.maximumReturnMileage() + " miles."
                    : "Returning-car mileage applies only to a replacement.");
        }
        JsonNode text = details.get("specialRequirements");
        if (text == null || !text.isTextual() || text.textValue().length() > limits.maximumSpecialRequirements()
                || CONTROL.matcher(text.textValue()).find()) {
            return ReviewResult.invalid("specialRequirements", "Use at most " + limits.maximumSpecialRequirements()
                    + " characters. Requests do not change released stock.");
        }
        return null;
    }

    /** The stored shape of details: contact, mileage (null when absent) and the text; nothing else survives. */
    static ObjectNode safeDetails(JsonNode details) {
        ObjectNode out = ReviewResult.F.objectNode();
        ObjectNode contact = out.putObject("contact");
        JsonNode c = details.path("contact");
        if (c.has("phone")) contact.set("phone", c.get("phone"));
        if (c.has("email")) contact.set("email", c.get("email"));
        JsonNode miles = details.get("expectedReturnMileage");
        if (miles == null || miles.isNull()) out.putNull("expectedReturnMileage");
        else out.put("expectedReturnMileage", miles.longValue());
        if (details.has("specialRequirements")) out.set("specialRequirements", details.get("specialRequirements"));
        return out;
    }
}
