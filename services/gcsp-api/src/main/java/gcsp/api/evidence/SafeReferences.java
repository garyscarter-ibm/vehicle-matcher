package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** The three reference-safety rules of Node's application-vehicle-details.js, applied over WhatwgUrl. */
final class SafeReferences {

    private static final Pattern SCHEME_PREFIX = Pattern.compile("^[a-z][a-z0-9+.-]*:", Pattern.CASE_INSENSITIVE);
    private static final Pattern PRIVATE_HOST = Pattern.compile(
            "^(localhost|.*\\.local|127\\..*|0\\..*|10\\..*|192\\.168\\..*|172\\.(1[6-9]|2\\d|3[01])\\..*|\\[.*\\])$");
    private static final Pattern LANGUAGE = Pattern.compile("[a-z]{2}(?:-[A-Z]{2})?");
    private static final String DAY = "[0-9]{4}-[0-9]{2}-[0-9]{2}";
    private static final String CONTEXT = "brands/bmwCar/countries/[a-z]{2}/effect-dates/" + DAY + "/order-dates/" + DAY;
    private static final Pattern LOCALISATION = Pattern.compile("/localisations/overridden-vehicle-data/sources/pcaso/" + CONTEXT
            + "/applications/connext/models/[A-Z0-9]{4,12}/options/languages/[a-z]{2}");
    private static final Pattern TREE = Pattern.compile("/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/" + CONTEXT);
    private static final Pattern SOLVER = Pattern.compile("/rulesolver/constructibility-check/rule-sets/pcaso,con/" + CONTEXT
            + "/models/[A-Z0-9]{4,12}");
    private static final Map<String, Pattern> LOCALISATION_PARAMS = Map.of("trim", Pattern.compile("[A-Z0-9]{4,12}"));
    private static final Map<String, Pattern> TREE_PARAMS = Map.of("gfs-policy", Pattern.compile("none"),
            "cluster", Pattern.compile("default"), "model-ranges", Pattern.compile("[A-Z0-9]{3,12}"),
            "future-models", Pattern.compile("(true|false)"), "closest-fallback", Pattern.compile("(true|false)"));
    private static final Map<String, Pattern> SOLVER_PARAMS = Map.of("application", Pattern.compile("connext"),
            "add-rules-for-mandatory-element-classes", Pattern.compile("(fabric|paint|rim)(,(fabric|paint|rim))*"),
            "included-elements", Pattern.compile("[A-Z0-9]{4,12}(,[A-Z0-9]{4,12})*"),
            "mandatory-elements", Pattern.compile("([A-Z0-9]{4,12}(,[A-Z0-9]{4,12})*)?"));

    private SafeReferences() {}

    static boolean safeReference(String v) {
        if (!ContractChecks.textOk(v)) return false;
        if (!v.contains("://")) {
            if (SCHEME_PREFIX.matcher(v).find() || v.indexOf('?') >= 0 || v.startsWith("//") || v.indexOf('\\') >= 0) return false;
            for (String segment : v.split("/", -1)) if (segment.equals("..")) return false;
            return true;
        }
        WhatwgUrl url = WhatwgUrl.parse(v);
        return url != null && !url.hasCredentials() && !url.hasSearch() && !PRIVATE_HOST.matcher(url.host).matches();
    }

    /** Public source citations may carry one documented language parameter; assets and credentials may not. */
    static boolean safeSourceReference(String v) {
        return safeReference(v) || languageCitation(v);
    }

    /** Node passes a profile source of any JSON type to new URL(), which coerces it to a string first. */
    static boolean safeSourceReference(JsonNode node) {
        if (node == null) return false;
        return node.isTextual() ? safeSourceReference(node.textValue()) : languageCitation(Js.coerce(node));
    }

    /** The language-parameter branch alone; a non-string member reaches it through JavaScript string coercion. */
    static boolean languageCitation(String v) {
        WhatwgUrl url = v == null ? null : WhatwgUrl.parse(v);
        if (url == null || url.hasCredentials()) return false;
        List<String[]> entries = url.searchParams();
        if (entries.size() != 1 || !"language".equals(entries.get(0)[0]) || !LANGUAGE.matcher(entries.get(0)[1]).matches()) return false;
        return safeReference(url.hrefWithoutQuery());
    }

    /** Retained v2 public catalogue citations keep their documented GET context; never for image or executable assets. */
    static boolean safeV2SourceReference(String value) {
        if (safeSourceReference(value)) return true;
        WhatwgUrl url = value == null ? null : WhatwgUrl.parse(value);
        if (url == null || !ContractChecks.textOk(value) || !"prod.ucp.bmw.cloud".equals(url.host) || !url.port.isEmpty()
                || url.hasCredentials() || url.hasHash()) return false;
        Map<String, Pattern> allowed;
        if (LOCALISATION.matcher(url.path).matches()) allowed = LOCALISATION_PARAMS;
        else if (TREE.matcher(url.path).matches()) allowed = TREE_PARAMS;
        else if (SOLVER.matcher(url.path).matches()) allowed = SOLVER_PARAMS;
        else return false;
        List<String[]> entries = url.searchParams();
        Set<String> names = new HashSet<>();
        for (String[] entry : entries) {
            Pattern rule = allowed.get(entry[0]);
            if (rule == null || !rule.matcher(entry[1]).matches()) return false;
            names.add(entry[0]);
        }
        return !entries.isEmpty() && names.size() == entries.size();
    }
}
