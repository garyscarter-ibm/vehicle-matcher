package gcsp.api.production;

import java.io.PrintWriter;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.logging.Logger;
import javax.sql.DataSource;

/** Test wrapper: commit() either really commits then throws, or throws without committing. */
final class FlakyCommitDataSource implements DataSource {

    enum Mode { COMMIT_THEN_FAIL, FAIL_WITHOUT_COMMIT }

    private final DataSource delegate;
    private final Mode mode;

    FlakyCommitDataSource(DataSource delegate, Mode mode) {
        this.delegate = delegate;
        this.mode = mode;
    }

    @Override
    public Connection getConnection() throws SQLException {
        Connection real = delegate.getConnection();
        InvocationHandler h = (proxy, method, args) -> {
            if (method.getName().equals("commit")) {
                if (mode == Mode.COMMIT_THEN_FAIL) real.commit();
                throw new SQLException("connection lost during commit", "08006");
            }
            try {
                return method.invoke(real, args);
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
