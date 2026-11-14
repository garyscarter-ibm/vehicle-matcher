package gcsp.api.scenario;

/** The scenario provider names: none seeds nothing; demo prepares fictional people explicitly. */
public final class ScenarioProvider {

    public static final String NONE = "none";
    public static final String DEMO = "demo";

    private ScenarioProvider() {}

    /** none or demo; anything else stops startup. */
    public static String normalise(String name) {
        String n = name == null || name.isBlank() ? NONE : name.trim();
        if (!NONE.equals(n) && !DEMO.equals(n)) {
            throw new IllegalStateException("Unknown gcsp.scenario.provider '" + n + "'; supported: none, demo");
        }
        return n;
    }
}
