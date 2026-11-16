package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.comparison.ComparisonJobStore.Insert;
import gcsp.api.comparison.ComparisonJobStore.Job;
import gcsp.api.comparison.RetainedComparisonResults.Retained;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import io.quarkus.runtime.ShutdownEvent;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Greg's comparison jobs: one at a time on one daemon thread, every state change in comparison_jobs. The database,
 * not this class, decides that one job runs per environment, so a restart or a second instance cannot double-run.
 */
@ApplicationScoped
public class ComparisonJobs {

    public static final String JOBS_KEY = "comparison.jobs.v1";
    static final String RERUNS_OFF = "Reruns are not started from this screen.";
    static final String BUSY = "A comparison is already running. Wait for it to finish.";
    static final String FAILED = "The comparison could not be completed.";
    static final String NOT_STORED = "The comparison finished but its result could not be stored.";
    static final String BACKEND_STOPPED = "The backend stopped before the comparison finished.";
    static final String BACKEND_RESTARTED = "The backend restarted before the comparison finished.";
    private static final String TIMEOUT = "timeout";
    private static final String SHUTDOWN = "shutdown";
    private static final Logger LOG = Logger.getLogger(ComparisonJobs.class);
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final int COMMAND_MAX = 128;

    /** An HTTP status with its JSON body. */
    public record Answer(int http, ObjectNode body) {}

    /** The running job: its stop reason is set once, by the limit timer or by shutdown, before the thread is interrupted. */
    private static final class Active {
        final String jobId;
        final String environmentId;
        final String runId;
        final JsonNode request;
        final int seedsTotal;
        final int stepsTotal;
        final String reasonOnTimeout;
        final AtomicReference<String> stop = new AtomicReference<>();
        final CountDownLatch done = new CountDownLatch(1);
        volatile Thread thread;
        volatile ScheduledFuture<?> timer;

        Active(String jobId, String environmentId, String runId, JsonNode request, int seedsTotal, int stepsTotal,
                String reasonOnTimeout) {
            this.jobId = jobId;
            this.environmentId = environmentId;
            this.runId = runId;
            this.request = request;
            this.seedsTotal = seedsTotal;
            this.stepsTotal = stepsTotal;
            this.reasonOnTimeout = reasonOnTimeout;
        }
    }

    @Inject
    ComparisonService service;

    @Inject
    PolicyService policy;

    @Inject
    PolicyClock clock;

    @Inject
    ComparisonReplay replay;

    @ConfigProperty(name = "gcsp.comparison.reruns", defaultValue = "false")
    String rerunsFlag;

    @ConfigProperty(name = "gcsp.comparison.code-revision", defaultValue = "unknown")
    String codeRevision;

    private Supplier<DataSource> dataSource;
    private Supplier<RunContext> scope;
    private BooleanSupplier available;
    private boolean reruns;
    private final String instanceId = UUID.randomUUID().toString();
    private ExecutorService worker;
    private ScheduledExecutorService timer;
    private volatile Active active;
    /** Tests only: replaces the policy's timeoutSeconds, in milliseconds. */
    volatile Long timeoutMillisOverride;

    ComparisonJobs() {}

    /** Plain wiring for tests that run the jobs against one schema without the container. */
    ComparisonJobs(DataSource source, RunContext run, PolicyService policy, PolicyClock clock, ComparisonReplay replay,
            boolean reruns, String codeRevision) {
        this.dataSource = () -> source;
        this.scope = () -> run;
        this.available = () -> true;
        this.policy = policy;
        this.clock = clock;
        this.replay = replay;
        this.reruns = reruns;
        this.codeRevision = codeRevision;
    }

    @PostConstruct
    void wire() {
        dataSource = service::dataSource;
        scope = () -> service.scope("comparison");
        available = service::available;
        reruns = "true".equals(rerunsFlag) || "1".equals(rerunsFlag);
    }

    void onStart(@Observes @Priority(ComparisonStartup.AFTER_PERSISTENCE + 10) StartupEvent event) {
        recoverStale();
    }

    void onStop(@Observes ShutdownEvent event) {
        close();
    }

    public boolean reruns() {
        return reruns;
    }

    public boolean available() {
        return available.getAsBoolean();
    }

    private ComparisonJobStore store() {
        return new ComparisonJobStore(dataSource.get());
    }

    /** Marks every job another instance left running as interrupted; returns how many. Failures are logged. */
    public int recoverStale() {
        if (!available()) return 0;
        try {
            return store().interruptStale(scope.get().environmentId(), instanceId, BACKEND_RESTARTED, Instant.now());
        } catch (SQLException | RuntimeException e) {
            LOG.warnf("GCSP comparison recovery failed (%s); stale jobs stay as they are", e.getClass().getSimpleName());
            return 0;
        }
    }

    // ---- start ----

    /** The Greg command: validate, claim the running slot in one insert, then hand the run to the executor. */
    public Answer start(String actorId, JsonNode body) {
        ObjectNode rest = body != null && body.isObject() ? ((ObjectNode) body).deepCopy() : null;
        JsonNode command = rest == null ? null : rest.remove("commandId");
        boolean commandOk = command != null && command.isTextual() && !command.textValue().isEmpty()
                && command.textValue().length() <= COMMAND_MAX;
        ComparisonRequests.Outcome parsed = ComparisonRequests.parse(rest == null ? body : rest);
        if (!parsed.ok() || !commandOk) return invalid(parsed, commandOk, rest != null);
        if (!reruns) return error(403, "forbidden", "comparison-reruns-off", RERUNS_OFF, false);
        String commandId = command.textValue();
        JsonNode request = parsed.value();
        String digest = CanonicalJson.digest(request);
        ObjectNode shown = shown(request);
        try {
            RunContext run = scope.get();
            recoverStale();
            ComparisonJobStore jobs = store();
            Optional<Job> same = jobs.byCommand(run.environmentId(), actorId, commandId);
            if (same.isPresent()) return replayOf(same.get(), digest);
            Optional<Job> busy = jobs.running(run.environmentId());
            if (busy.isPresent()) return busy(busy.get().jobId());
            Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
            double timeoutSeconds = limit(run, now);
            if (Double.isNaN(timeoutSeconds)) {
                ObjectNode out = error(503, "unavailable", "job-limits-unavailable",
                        "The comparison job limits (" + JOBS_KEY + ") are not available.", true).body();
                out.put("key", JOBS_KEY);
                return new Answer(503, out);
            }
            ComparisonExperiments.Prepared prepared;
            try {
                prepared = ComparisonExperiments.prepare(request, policy, PolicyClock.iso(now), run.runId());
            } catch (RuntimeException e) {
                String boundary = ComparisonRequests.refusedBoundary(e);
                if (boundary == null) throw e;
                JsonNode change = request.get("change");
                ObjectNode refusal = ComparisonRequests.refusalFor(boundary, request.get("experimentId").textValue(),
                        change).body().deepCopy();
                refusal.put("retryable", false);
                return new Answer(400, refusal);
            }
            String jobId = "comparison-job-" + UUID.randomUUID();
            int seeds = prepared.plan().seeds().size();
            int steps = prepared.plan().steps();
            Job row = new Job(jobId, request.get("experimentId").textValue(), "running", 0, seeds, 0, steps, now, null, null,
                    null, shown, actorId, commandId, digest, instanceId, 1);
            Insert inserted = jobs.insertRunning(run.environmentId(), row);
            if (inserted == Insert.BUSY) {
                return busy(jobs.running(run.environmentId()).map(Job::jobId).orElse(null));
            }
            if (inserted == Insert.DUPLICATE_COMMAND) {
                Optional<Job> raced = jobs.byCommand(run.environmentId(), actorId, commandId);
                if (raced.isPresent()) return replayOf(raced.get(), digest);
                return unavailable();
            }
            Active job = new Active(jobId, run.environmentId(), run.runId(), request, seeds, steps,
                    "The comparison was stopped at its limit of " + seconds(timeoutSeconds) + " seconds.");
            submit(job, timeoutSeconds, jobs);
            ObjectNode out = JSON.objectNode();
            out.put("status", "pending");
            out.set("value", row.view());
            return new Answer(202, out);
        } catch (SQLException | RuntimeException e) {
            LOG.warnf("GCSP comparison start failed (%s)", e.getClass().getSimpleName());
            return unavailable();
        }
    }

    /** The stored request always carries the change key. */
    private static ObjectNode shown(JsonNode request) {
        ObjectNode out = JSON.objectNode();
        out.set("experimentId", request.get("experimentId"));
        out.set("change", request.get("change") == null ? JSON.nullNode() : request.get("change"));
        return out;
    }

    private static Answer replayOf(Job existing, String digest) {
        if (!existing.inputDigest().equals(digest)) {
            return error(409, "conflict", "command-input-changed", "This command id was already used for a different request.", false);
        }
        ObjectNode out = JSON.objectNode();
        out.put("status", existing.running() ? "pending" : "ok");
        out.set("value", existing.view());
        return new Answer(existing.running() ? 202 : 200, out);
    }

    private static Answer busy(String jobId) {
        ObjectNode out = error(409, "conflict", "job-running", BUSY, false).body();
        if (jobId != null) out.put("jobId", jobId);
        return new Answer(409, out);
    }

    private static Answer unavailable() {
        return error(503, "unavailable", "comparison-unavailable", "The comparison could not be started.", true);
    }

    private static Answer invalid(ComparisonRequests.Outcome parsed, boolean commandOk, boolean bodyIsObject) {
        ObjectNode body;
        if (parsed.ok()) {
            body = JSON.objectNode();
            body.put("status", "invalid");
            body.put("code", "invalid-experiment");
            body.putArray("reasons");
        } else {
            body = parsed.body().deepCopy();
        }
        if (!commandOk && bodyIsObject) {
            ArrayNode reasons = (ArrayNode) body.get("reasons");
            reasons.insertObject(0).put("field", "commandId").put("reason", "Use text of 1 to " + COMMAND_MAX + " characters.");
        }
        body.put("retryable", false);
        return new Answer(400, body);
    }

    private static Answer error(int http, String status, String code, String reason, boolean retryable) {
        ObjectNode out = JSON.objectNode();
        out.put("status", status);
        out.put("code", code);
        out.put("reason", reason);
        out.put("retryable", retryable);
        return new Answer(http, out);
    }

    /** timeoutSeconds of comparison.jobs.v1 at the current run, or NaN when absent or invalid. */
    private double limit(RunContext run, Instant now) {
        Long override = timeoutMillisOverride;
        if (override != null) return override / 1000.0;
        PolicyResult read = policy.getAssumption(JOBS_KEY, new PolicyRead(run.runId(), PolicyClock.iso(clock.now(run)), null));
        JsonNode row = read.ok() && read.value() != null ? read.value().get("value") : null;
        boolean good = row != null && row.isObject() && ComparisonValidation.finite(row.get("schemaVersion"))
                && row.get("schemaVersion").doubleValue() == 1 && ComparisonValidation.finite(row.get("timeoutSeconds"))
                && row.get("timeoutSeconds").doubleValue() > 0;
        return good ? row.get("timeoutSeconds").doubleValue() : Double.NaN;
    }

    private static String seconds(double value) {
        return value == Math.rint(value) ? Long.toString((long) value) : Double.toString(value);
    }

    private synchronized void submit(Active job, double timeoutSeconds, ComparisonJobStore jobs) throws SQLException {
        try {
            if (worker == null) {
                worker = Executors.newSingleThreadExecutor(task -> daemon(task, "comparison-job"));
                timer = Executors.newSingleThreadScheduledExecutor(task -> daemon(task, "comparison-job-timer"));
            }
            active = job;
            long millis = (long) Math.min(timeoutSeconds * 1000, Integer.MAX_VALUE);
            job.timer = timer.schedule(() -> {
                Thread running = job.thread;
                if (job.stop.compareAndSet(null, TIMEOUT) && running != null) running.interrupt();
            }, millis, TimeUnit.MILLISECONDS);
            worker.execute(() -> execute(job));
        } catch (RuntimeException e) {
            if (job.timer != null) job.timer.cancel(false);
            if (active == job) active = null;
            jobs.finish(job.environmentId, job.jobId, "failed", "The comparison could not be started.", Instant.now());
            throw e;
        }
    }

    private static Thread daemon(Runnable task, String name) {
        Thread thread = new Thread(task, name);
        thread.setDaemon(true);
        return thread;
    }

    // ---- run ----

    private void execute(Active job) {
        job.thread = Thread.currentThread();
        try {
            if (job.stop.get() != null) {
                finish(job, "interrupted", BACKEND_STOPPED);
                return;
            }
            Map<String, Integer> perSeed = new HashMap<>();
            int perSeedSteps = job.stepsTotal / Math.max(1, job.seedsTotal);
            ObjectNode result = ComparisonRunner.run(job.request, policy, replay, codeRevision,
                    () -> PolicyClock.iso(Instant.now()), step -> {
                        if (job.stop.get() != null) throw new ComparisonInterrupted();
                        perSeed.merge(step.seed().asText(), 1, Integer::sum);
                        long done = perSeed.values().stream().filter(c -> c >= perSeedSteps).count();
                        try {
                            store().progress(job.environmentId, job.jobId, (int) done, step.completed());
                        } catch (SQLException | RuntimeException e) {
                            LOG.warnf("GCSP comparison progress write failed (%s)", e.getClass().getSimpleName());
                        }
                    }, job.runId);
            job.timer.cancel(false);
            Thread.interrupted();
            record(job, result);
        } catch (ComparisonUnavailable e) {
            Thread.interrupted();
            finish(job, "failed", e.reason());
        } catch (Throwable t) {
            Thread.interrupted();
            LOG.warnf("GCSP comparison job ended early (%s)", t.getClass().getSimpleName());
            String stop = job.stop.get();
            if (SHUTDOWN.equals(stop)) finish(job, "interrupted", BACKEND_STOPPED);
            else finish(job, "failed", TIMEOUT.equals(stop) ? job.reasonOnTimeout : FAILED);
        } finally {
            job.timer.cancel(false);
            Thread.interrupted();
            if (active == job) active = null;
            job.done.countDown();
        }
    }

    private void record(Active job, ObjectNode result) {
        try {
            Retained retained = RetainedComparisonResults.ofRun(result);
            if (store().succeed(job.environmentId, job.jobId, retained, Instant.now())) return;
        } catch (Exception e) {
            LOG.warnf("GCSP comparison result was not stored (%s)", e.getClass().getSimpleName());
        }
        finish(job, "failed", NOT_STORED);
    }

    private void finish(Active job, String status, String reason) {
        try {
            store().finish(job.environmentId, job.jobId, status, reason, Instant.now());
        } catch (SQLException | RuntimeException e) {
            LOG.warnf("GCSP comparison job could not be closed (%s); a restart marks it interrupted", e.getClass().getSimpleName());
        }
    }

    /** Stops a running job as interrupted (the backend stopped), then the executors. Safe to call again. */
    public void close() {
        Active job = active;
        ExecutorService stopWorker;
        ScheduledExecutorService stopTimer;
        synchronized (this) {
            stopWorker = worker;
            stopTimer = timer;
            worker = null;
            timer = null;
        }
        if (job != null && job.stop.compareAndSet(null, SHUTDOWN)) {
            Thread running = job.thread;
            if (running != null) running.interrupt();
            boolean finished = false;
            try {
                finished = job.done.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            if (!finished) finish(job, "interrupted", BACKEND_STOPPED);
        }
        if (stopWorker != null) stopWorker.shutdownNow();
        if (stopTimer != null) stopTimer.shutdownNow();
    }

    // ---- read ----

    /** The named job, else the newest by start time; empty when there is none. */
    public Optional<ObjectNode> read(String jobId) throws SQLException {
        recoverStale();
        RunContext run = scope.get();
        ComparisonJobStore jobs = store();
        Optional<Job> found = jobId == null ? jobs.latest(run.environmentId()) : jobs.byId(run.environmentId(), jobId);
        return found.map(Job::view);
    }
}
