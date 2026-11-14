package gcsp.api.allocation;

import java.io.PrintWriter;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import javax.sql.DataSource;

/** Test wrapper: the Nth commit either really commits then throws, or throws without committing. */
final class FlakyCommits implements DataSource {

    private final DataSource delegate;
    private final int failOn;
    private final boolean commitFirst;
    private final AtomicInteger commits = new AtomicInteger();
    private int afterOn;
    private Runnable after;

    /** Runs {@code action} right after the Nth commit really succeeds (a change landing between two commands). */
    FlakyCommits afterCommit(int n, Runnable action) {
        this.afterOn = n;
        this.after = action;
        return this;
    }

    FlakyCommits(DataSource delegate, int failOn, boolean commitFirst) {
        this.delegate = delegate;
        this.failOn = failOn;
        this.commitFirst = commitFirst;
    }

    @Override
    public Connection getConnection() throws SQLException {
        Connection real = delegate.getConnection();
        InvocationHandler h = (proxy, method, args) -> {
            boolean commit = method.getName().equals("commit");
            int n = commit ? commits.incrementAndGet() : 0;
            if (commit && n == failOn) {
                if (commitFirst) real.commit();
                throw new SQLException("connection lost during commit", "08006");
            }
            try {
                Object result = method.invoke(real, args);
                if (commit && n == afterOn && after != null) after.run();
                return result;
            } catch (InvocationTargetException e) {
                throw e.getCause();
            }
        };
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class}, h);
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
    public void setLogWriter(PrintWriter out) {}

    @Override
    public void setLoginTimeout(int seconds) {}

    @Override
    public int getLoginTimeout() {
        return 0;
    }

    @Override
    public Logger getParentLogger() {
        return Logger.getGlobal();
    }

    @Override
    public <T> T unwrap(Class<T> iface) throws SQLException {
        throw new SQLException("not a wrapper");
    }

    @Override
    public boolean isWrapperFor(Class<?> iface) {
        return false;
    }
}
