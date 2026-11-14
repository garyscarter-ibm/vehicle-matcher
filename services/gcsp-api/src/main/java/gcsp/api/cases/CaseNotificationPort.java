package gcsp.api.cases;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Tx;

/** Called inside every command that changes a case, so the notification is queued with the change. */
public interface CaseNotificationPort {

    void caseUpdated(Tx tx, ObjectNode caseUpdate);
}
