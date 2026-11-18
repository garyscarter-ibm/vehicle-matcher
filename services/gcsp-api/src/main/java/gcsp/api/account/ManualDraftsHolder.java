package gcsp.api.account;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Optional;

/** Builds the one ManualDrafts lazily over the datasource and the account service; empty without persistence. */
@ApplicationScoped
public class ManualDraftsHolder {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    AccountService accounts;

    private ManualDrafts drafts;

    public synchronized Optional<ManualDrafts> drafts() {
        if (!persistence.active()) return Optional.empty();
        if (drafts == null) drafts = new ManualDrafts(accounts, dataSource.get(), persistence.runner());
        return Optional.of(drafts);
    }
}
