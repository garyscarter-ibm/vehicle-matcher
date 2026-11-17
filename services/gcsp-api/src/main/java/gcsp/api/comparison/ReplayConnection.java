package gcsp.api.comparison;

import java.io.PrintWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.logging.Logger;
import javax.sql.DataSource;

/** A tiny single-thread pool for one replay: close() resets and returns the connection, shutdown() closes them all. */
final class ReplayConnection implements DataSource, AutoCloseable {

    private final DataSource source;
    private final Deque<Connection> idle = new ArrayDeque<>();
    private final List<Connection> all = new ArrayList<>();
    private static final int ANALYZE_EVERY = 500;
    private long commits;

    ReplayConnection(DataSource source) {
        this.source = source;
    }

    @Override
    public synchronized Connection getConnection() throws SQLException {
        Connection real = idle.poll();
        if (real == null || real.isClosed()) {
            real = source.getConnection();
            // Plans cached while a scratch table was still empty scan whole allocations, so each statement plans afresh.
            real.unwrap(org.postgresql.PGConnection.class).setPrepareThreshold(0);
            try (java.sql.Statement st = real.createStatement()) {
                st.execute("SET synchronous_commit = off");
            }
            all.add(real);
        }
        Connection target = real;
        return (Connection) Proxy.newProxyInstance(ReplayConnection.class.getClassLoader(),
                new Class<?>[] {Connection.class}, (proxy, method, args) -> {
                    try {
                        if (method.getName().equals("close") && method.getParameterCount() == 0) {
                            giveBack(target);
                            return null;
                        }
                        if (method.getName().equals("isClosed") && method.getParameterCount() == 0) return false;
                        Object out = method.invoke(target, args);
                        if (method.getName().equals("commit") && ++commits % ANALYZE_EVERY == 0) analyze(target);
                        return out;
                    } catch (InvocationTargetException e) {
                        throw e.getCause();
                    }
                });
    }

    // Stale scratch statistics make allocation's taken-check scan a whole allocation per contender; keep them current.
    private static void analyze(Connection c) throws SQLException {
        try (java.sql.Statement st = c.createStatement()) {
            st.execute("ANALYZE allocation_attempts");
        }
        if (!c.getAutoCommit()) c.commit();
    }

    private synchronized void giveBack(Connection c) throws SQLException {
        if (c.isClosed()) return;
        if (!c.getAutoCommit()) {
            c.rollback();
            c.setAutoCommit(true);
        }
        idle.push(c);
    }

    @Override
    public synchronized void close() {
        for (Connection c : all) {
            try {
                c.close();
            } catch (SQLException e) {
                // the schema drop uses its own connection; a failed close here leaks nothing owned
            }
        }
        all.clear();
        idle.clear();
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public <T> T unwrap(Class<T> type) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public boolean isWrapperFor(Class<?> type) {
        return false;
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
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        throw new SQLFeatureNotSupportedException();
    }
}
