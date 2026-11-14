package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;

/** Port for what happened since Greg's last submission. Submission is FUCQ-478; none can exist in this service yet. */
public interface SubmissionHistory {

    /** The replan value for the plan just read: {status:'no-submission'} when nothing was ever submitted. */
    JsonNode replan(RunContext context, JsonNode plan);
}
