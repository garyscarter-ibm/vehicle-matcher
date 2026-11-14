package gcsp.api.notify;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Optional;
import org.junit.jupiter.api.Test;

class NotificationDrainWiringTest {

    @Test
    void drainNowRunsTheDispatcherAndSurvivesItsFailure() throws Exception {
        try (NotifyFixture f = NotifyFixture.create()) {
            Doubles.Mail mail = new Doubles.Mail();
            NotificationDispatcher real = new NotificationDispatcher(f.pool(), new Doubles.Rules(), new Doubles.Facts(),
                    mail, new NotifyFixture.Clock(), NotifyFixture.ENV, Optional.empty());
            boolean[] fail = {false};
            NotificationDrain drain = new NotificationDrain();
            drain.notifications = new Notifications() {
                @Override
                public NotificationDispatcher dispatcher() {
                    if (fail[0]) throw new IllegalStateException("boom");
                    return real;
                }
            };
            f.createOffer("off-1", "emp-1");
            drain.drainNow();
            assertEquals("sent", f.delivery("state", "notification:offer:off-1:v1"));
            assertEquals(1, mail.calls.size());
            fail[0] = true;
            drain.drainNow();
            assertEquals(1, mail.calls.size());
        }
    }
}
