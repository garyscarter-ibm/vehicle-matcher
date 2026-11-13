package gcsp.api.persistence;

import java.util.Map;
import java.util.Set;
import org.eclipse.microprofile.config.spi.ConfigSource;

/** Turns the datasource and Flyway on only when GCSP_DATABASE_URL is set; an explicit setting still wins. */
public class PersistenceConfigSource implements ConfigSource {

    private static final Set<String> NAMES = Set.of("quarkus.datasource.active", "quarkus.flyway.active");

    @Override
    public Map<String, String> getProperties() {
        return Map.of();
    }

    @Override
    public Set<String> getPropertyNames() {
        return NAMES;
    }

    @Override
    public String getValue(String propertyName) {
        if (!NAMES.contains(propertyName)) return null;
        String url = System.getenv("GCSP_DATABASE_URL");
        if (url == null || url.isBlank()) url = System.getProperty("GCSP_DATABASE_URL");
        return String.valueOf(url != null && !url.isBlank());
    }

    @Override
    public String getName() {
        return "gcsp-persistence-activation";
    }

    @Override
    public int getOrdinal() {
        return 260;
    }
}
