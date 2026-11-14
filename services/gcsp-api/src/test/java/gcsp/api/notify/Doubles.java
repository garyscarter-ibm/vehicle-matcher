package gcsp.api.notify;

import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Supplier;

/** Scriptable test doubles for the notify ports. */
final class Doubles {

    private Doubles() {}

    static final class Rules implements DeliveryRules {
        volatile Result result = new DeliveryRules.Rules("test-v1", 3, 30, 300);

        @Override
        public Result read(String runId, Instant asOf) {
            return result;
        }
    }

    static final class Facts implements OfferFacts {
        final Map<String, Result> byOffer = new ConcurrentHashMap<>();
        volatile Result fallback;
        int lookups;

        @Override
        public synchronized Result lookup(RunContext ctx, String offerId) {
            lookups++;
            return byOffer.getOrDefault(offerId, fallback == null ? active(offerId, "emp-1") : fallback);
        }
    }

    static OfferFacts.Offer active(String offerId, String employeeId) {
        return new OfferFacts.Offer(offerId, employeeId, "active", NotifyFixture.T0.plusSeconds(3 * 86400 + 5400),
                "MINI Cooper S", 1250, null);
    }

    /** Plays one scripted answer per call (the last repeats); records every call. */
    static final class Mail implements MailTransport {
        final List<Supplier<Result>> script = new ArrayList<>();
        final List<DeliveryAttempt> calls = new CopyOnWriteArrayList<>();
        final List<OfferMessage> messages = new CopyOnWriteArrayList<>();
        volatile Runnable beforeSend = () -> {};

        Mail then(Supplier<Result> step) {
            script.add(step);
            return this;
        }

        @Override
        public Result send(RunContext ctx, DeliveryAttempt attempt, OfferMessage message) {
            calls.add(attempt);
            messages.add(message);
            beforeSend.run();
            int i = Math.min(calls.size(), script.size()) - 1;
            return script.isEmpty() ? new Accepted() : script.get(i).get();
        }

        @Override
        public String name() {
            return "captured";
        }
    }

    static MailTransport.Result accepted() {
        return new MailTransport.Accepted();
    }

    static MailTransport.Result retryable() {
        return new MailTransport.Failed("provider-unavailable", true);
    }
}
