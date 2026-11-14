package gcsp.api.cases;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Tx;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;

/** Queues the update as an outbox event; delivery and rendering belong to the notify package. */
@DefaultBean
@ApplicationScoped
public class OutboxCaseNotifications implements CaseNotificationPort {

    @Override
    public void caseUpdated(Tx tx, ObjectNode caseUpdate) {
        String caseId = caseUpdate.path("caseId").asText();
        long version = caseUpdate.path("caseVersion").asLong();
        ObjectNode payload = CaseJson.obj();
        payload.set("caseUpdate", caseUpdate);
        payload.put("recipientId", caseUpdate.path("employeeId").asText());
        payload.put("messageKind", "renewal-case-update").put("messageVersion", "1");
        tx.emit("case:" + caseId + ":update:" + version, "renewal-case-update", payload);
    }
}
