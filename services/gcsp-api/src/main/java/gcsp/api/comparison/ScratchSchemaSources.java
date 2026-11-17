package gcsp.api.comparison;

import java.util.Optional;
import java.util.function.Function;
import javax.sql.DataSource;
import org.postgresql.ds.PGSimpleDataSource;

/** Builds plain DataSources from the configured datasource settings, bound to a scratch schema when one is named. */
final class ScratchSchemaSources implements Function<String, DataSource> {

    private final String url;
    private final String user;
    private final String password;

    ScratchSchemaSources(Optional<String> url, Optional<String> user, Optional<String> password) {
        this.url = url.orElse("").trim();
        this.user = user.orElse("").trim();
        this.password = password.orElse("");
    }

    @Override
    public DataSource apply(String schema) {
        if (url.isEmpty()) throw new ComparisonRunError("unavailable", "scratch-database");
        PGSimpleDataSource source = new PGSimpleDataSource();
        source.setUrl(url);
        if (!user.isEmpty()) source.setUser(user);
        if (!password.isEmpty()) source.setPassword(password);
        if (schema != null) source.setCurrentSchema(schema);
        return source;
    }
}
