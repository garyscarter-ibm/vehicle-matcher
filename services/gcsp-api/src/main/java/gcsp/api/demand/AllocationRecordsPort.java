package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

/** Recorded allocation decisions, read inside the suitability snapshot; the view never evaluates or writes. */
public interface AllocationRecordsPort {

    /** The latest recorded decision of each (employee, car) pair that has one; empty when records are unavailable. */
    Optional<List<RecordedDecision>> read(Connection snapshot, DemandScope scope, List<String> employeeIds,
            List<String> orderUuids) throws SQLException;

    /** assignedEmployeeId is who the recorded run gave this car to; employeeAssignedOtherCar says the employee got another one. */
    record RecordedDecision(String employeeId, String orderUuid, String gateStatus, JsonNode score, JsonNode blockers,
            JsonNode unknowns, JsonNode reasons, String evaluatedAt, Long briefVersion, String policyVersion,
            String allocationRule, Long inputPermissionVersion, Long inputEmployeeVersion, String assignedEmployeeId,
            boolean employeeAssignedOtherCar) {}
}
