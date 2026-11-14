package gcsp.api.account;

public interface CurrentCarPort {

    /** A JSON array of confirmed current-car relationships (Node listCurrentCars). */
    SourceResult list(AccountScope scope);
}
