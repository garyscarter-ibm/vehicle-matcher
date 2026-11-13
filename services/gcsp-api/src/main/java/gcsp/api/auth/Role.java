package gcsp.api.auth;

import java.util.List;
import java.util.Optional;

/** The three application roles and the fixed capabilities each one grants. */
public enum Role {
    EMPLOYEE("employee", List.of("account:read")),
    GREG("greg", List.of("greg:read", "comparison:command")),
    PRESENTER("presenter", List.of("presenter:control", "presenter:inspect"));

    private final String wire;
    private final List<String> capabilities;

    Role(String wire, List<String> capabilities) {
        this.wire = wire;
        this.capabilities = capabilities;
    }

    public String wire() {
        return wire;
    }

    public List<String> capabilities() {
        return capabilities;
    }

    public static Optional<Role> fromWire(String name) {
        for (Role r : values()) {
            if (r.wire.equals(name)) {
                return Optional.of(r);
            }
        }
        return Optional.empty();
    }
}
