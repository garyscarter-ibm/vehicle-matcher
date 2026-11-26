package gcsp.api.appointments;

import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.util.Map;
import org.eclipse.microprofile.config.ConfigProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** A bounded test-only API host; the composition owns Maven's stop, join and emergency termination. */
@QuarkusTest
@TestProfile(F521ProofProfile.class)
@EnabledIfEnvironmentVariable(named = "GCSP_F521_READY_FILE", matches = ".+")
public class F521ProofHostTest {
    @Inject
    Persistence persistence;

    @Inject
    F521AppointmentsWiring appointments;

    @Test
    void hostTheConnectedProofUntilStopped() throws Exception {
        Path ready = F521AppointmentsWiring.localPath(System.getenv("GCSP_F521_READY_FILE"));
        Path stop = F521AppointmentsWiring.localPath(System.getenv("GCSP_F521_STOP_FILE"));
        Path control = F521AppointmentsWiring.localPath(System.getenv("GCSP_F521_CONTROL_FILE"));
        if (!ready.getParent().equals(stop.getParent()) || !ready.getParent().equals(control.getParent())
                || ready.equals(stop) || ready.equals(control) || stop.equals(control)) {
            throw new IllegalArgumentException("F521 markers must be distinct files in one owned directory");
        }
        if (!persistence.active()) throw new IllegalStateException("F521 requires native persistence");
        F521AppointmentsWiring.control();
        var run = persistence.guard().currentRun();
        int port = ConfigProvider.getConfig().getValue("quarkus.http.test-ssl-port", Integer.class);
        if (port < 1 || port > 65535) throw new IllegalArgumentException("F521 requires a fixed TLS test port");
        String json = new ObjectMapper().writeValueAsString(Map.of("ready", true, "port", port,
                "environmentId", run.environmentId(), "runId", run.runId()));
        Files.writeString(ready, json, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        long deadline = System.nanoTime() + Duration.ofSeconds(600).toNanos();
        while (!Files.exists(stop, LinkOption.NOFOLLOW_LINKS)) {
            if (System.nanoTime() >= deadline) throw new IllegalStateException("F521 proof host timed out after 600 seconds");
            Thread.sleep(100);
        }
        System.out.println("F521 appointment service instances created: " + appointments.createdServiceCount());
    }
}
