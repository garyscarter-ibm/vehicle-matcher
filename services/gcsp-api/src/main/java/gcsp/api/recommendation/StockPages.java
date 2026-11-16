package gcsp.api.recommendation;

import gcsp.api.persistence.RunContext;
import gcsp.api.supply.ReleasedCar;
import java.sql.SQLException;
import java.util.List;

/** The keyset page read of released cars; production binds it to gcsp.api.supply.ReleasedStock.page. */
@FunctionalInterface
public interface StockPages {

    List<ReleasedCar> page(RunContext scope, String afterOrderUuid, int limit) throws SQLException;
}
