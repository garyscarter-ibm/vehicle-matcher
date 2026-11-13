package gcsp.api.persistence;

/** One command's explicit SQL, run inside the open transaction. */
@FunctionalInterface
public interface Work {
    WorkResult run(Tx tx) throws Exception;
}
