package gcsp.api.ordering;

import javax.sql.DataSource;

/** Picks the ordering provider once at startup; an unknown name stops the service rather than falling back. */
public final class OrderingProviderSelection {

    private OrderingProviderSelection() {}

    public static OrderingProviderPort select(String name, DataSource dataSource) {
        String n = name == null || name.isBlank() ? "none" : name.trim();
        return switch (n) {
            case "none" -> new UnconfiguredOrderingProvider();
            case "synthetic" -> new SyntheticOrderingProvider(dataSource);
            default -> throw new IllegalArgumentException("Unknown ordering provider: " + n);
        };
    }
}
