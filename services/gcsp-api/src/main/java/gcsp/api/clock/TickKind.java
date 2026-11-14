package gcsp.api.clock;

/** Which handler stages a tick runs: presenter ticks run every stage, startup ticks only the startup stages. */
public enum TickKind {
    PRESENTER("presenter"),
    STARTUP("startup");

    private final String value;

    TickKind(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    static TickKind of(String value) {
        for (TickKind kind : values()) {
            if (kind.value.equals(value)) return kind;
        }
        throw new IllegalStateException("Unknown tick kind");
    }
}
