package gcsp.api.learning;

import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.SQLException;

/** The actual run instant and clock version a learning read is projected at. */
public interface LearningClock {

    /** now is ISO text; clockVersion is a non-empty String or a positive integer. */
    record Reading(String now, Object clockVersion) {}

    Reading now(RunContext context);

    /** Production readers use the record snapshot; injected pure clocks retain their supplied reading. */
    default Reading now(Connection snapshot, RunContext context) throws SQLException {
        return now(context);
    }
}
