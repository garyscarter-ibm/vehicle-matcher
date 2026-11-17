package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.approvals.HandoverPort;
import gcsp.api.documents.DocumentCasePort;
import gcsp.api.documents.LifecycleDocumentCases;
import io.quarkus.arc.Arc;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** The app as started binds the real producers, not the unconfigured defaults (no test alternatives in force). */
@QuarkusTest
@TestProfile(RealPortsProfile.class)
class RealPortsWiringTest {

    @Inject
    OrderStagePort stages;

    @Inject
    HandoverReadinessPort readiness;

    @Inject
    DocumentCasePort cases;

    @Inject
    HandoverPort handover;

    @Test
    void everyDefaultPortResolvesToItsRealAdapter() {
        assertEquals(ApprovalsOrderStage.class, beanClass(OrderStagePort.class));
        assertEquals(DocumentsHandoverReadiness.class, beanClass(HandoverReadinessPort.class));
        assertEquals(LifecycleDocumentCases.class, beanClass(DocumentCasePort.class));
        assertEquals(AppointmentHandover.class, beanClass(HandoverPort.class));
    }

    private static Class<?> beanClass(Class<?> type) {
        return Arc.container().instance(type).getBean().getBeanClass();
    }
}
