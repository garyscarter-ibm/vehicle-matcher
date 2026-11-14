package gcsp.api.policy;

import java.io.PrintWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.function.Predicate;
import java.util.logging.Logger;
import javax.sql.DataSource;

/** Test wrapper: runs a hook before matching statements, can fail every connection, or fail commit after it lands. */
final class FaultDataSource implements DataSource {

    private final DataSource delegate;
    private final Predicate<String> statement;
    private final Runnable beforeStatement;
    private final boolean commitThenFail;
    private final boolean unreachable;

    private FaultDataSource(DataSource delegate, Predicate<String> statement, Runnable before, boolean commitThenFail,
            boolean unreachable) {
        this.delegate = delegate;
        this.statement = statement;
        this.beforeStatement = before;
        this.commitThenFail = commitThenFail;
        this.unreachable = unreachable;
    }

    /** Runs the hook just before each statement whose SQL starts with the prefix. */
    static FaultDataSource before(DataSource delegate, String sqlPrefix, Runnable hook) {
        return new FaultDataSource(delegate, sql -> sql.startsWith(sqlPrefix), hook, false, false);
    }

    static FaultDataSource commitThenFail(DataSource delegate) {
        return new FaultDataSource(delegate, sql -> false, () -> { }, true, false);
    }

    static FaultDataSource unreachable(DataSource delegate) {
        return new FaultDataSource(delegate, sql -> false, () -> { }, false, true);
    }

    @Override
    public Connection getConnection() throws SQLException {
        if (unreachable) {
            throw new SQLException("connection refused to jdbc:postgresql://secret-host:5432/db", "08001");
        }
        Connection real = delegate.getConnection();
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("prepareStatement") && args != null && args[0] instanceof String sql
                            && statement.test(sql)) {
                        beforeStatement.run();
                    }
                    if (commitThenFail && method.getName().equals("commit")) {
                        real.commit();
                        throw new SQLException("connection lost during commit", "08006");
                    }
                    try {
                        return method.invoke(real, args);
                    } catch (InvocationTargetException e) {
                        throw e.getCause();
                    }
                });
    }

    @Override
    public Connection getConnection(String u, String p) throws SQLException {
        return getConnection();
    }

    @Override
    public PrintWriter getLogWriter() {
        return null;
    }

    @Override
    public void setLogWriter(PrintWriter out) {
    }

    @Override
    public void setLoginTimeout(int seconds) {
    }

    @Override
    public int getLoginTimeout() {
        return 0;
    }

    @Override
    public Logger getParentLogger() {
        return Logger.getGlobal();
    }

    @Override
    public <T> T unwrap(Class<T> iface) {
        throw new UnsupportedOperationException();
    }

    @Override
    public boolean isWrapperFor(Class<?> iface) {
        return false;
    }
}
