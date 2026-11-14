package gcsp.api.appointments;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;

/** Counts the SQL statements prepared through the wrapped data source (the service's own, not the provider's). */
final class CountingDataSource {

    private CountingDataSource() {}

    static DataSource wrap(DataSource inner, AtomicInteger statements) {
        return (DataSource) Proxy.newProxyInstance(DataSource.class.getClassLoader(), new Class<?>[] {DataSource.class},
                (proxy, method, args) -> {
                    Object result = invoke(inner, method, args);
                    if (!"getConnection".equals(method.getName())) return result;
                    Connection c = (Connection) result;
                    return Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                            (p, m, a) -> {
                                if (m.getName().equals("prepareStatement") || m.getName().equals("createStatement")) {
                                    statements.incrementAndGet();
                                }
                                return invoke(c, m, a);
                            });
                });
    }

    private static Object invoke(Object target, java.lang.reflect.Method m, Object[] args) throws Throwable {
        try {
            return m.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }
}
