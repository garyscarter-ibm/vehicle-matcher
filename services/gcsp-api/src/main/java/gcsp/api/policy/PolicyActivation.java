package gcsp.api.policy;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.WorkResult;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;

/**
 * Records which policy version a run has activated: the version in force at the clock's now, changed only by version
 * CAS on policy_run_activation. A port of server/gcsp/policy/activation.js.
 */
@ApplicationScoped
public class PolicyActivation {

    static final String COMMAND_TYPE = "policy.activate";
    private static final int ATTEMPTS = 3;
    private static final String RUN_STATUS = "SELECT status FROM runs WHERE environment_id = ? AND run_id = ?";
    private static final String STORED = "SELECT policy_version, version FROM policy_run_activation "
            + "WHERE environment_id = ? AND run_id = ?";

    private record Stored(String policyVersion, long version) {
    }

    private final PolicyService policy;
    private final PolicyDatabase database;
    private final PolicyClock clock;

    @Inject
    public PolicyActivation(PolicyService policy, PolicyDatabase database, PolicyClock clock) {
        this.policy = policy;
        this.database = database;
        this.clock = clock;
    }

    public PolicyResult activate(RunContext context) {
        if (!database.active()) {
            return unavailable();
        }
        try {
            for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
                String status = runStatus(context);
                if (!"active".equals(status)) {
                    return stale();
                }
                String asOf = PolicyClock.iso(clock.now(context));
                PolicyResult active = policy.getActiveVersion(new PolicyRead(context.runId(), asOf, null));
                if (!active.ok()) {
                    return active;
                }
                String version = active.policyVersion();
                Stored stored = stored(context);
                if (stored == null || !stored.policyVersion().equals(version)) {
                    Outcome outcome = store(context, stored, version, asOf);
                    if (outcome instanceof Outcome.Conflict conflict) {
                        if ("stale-run".equals(conflict.code())) {
                            return stale();
                        }
                        continue;
                    }
                    if (!(outcome instanceof Outcome.Committed)) {
                        return unavailable();
                    }
                }
                Stored finalStored = stored(context);
                String asOfAfter = PolicyClock.iso(clock.now(context));
                PolicyResult again = policy.getActiveVersion(new PolicyRead(context.runId(), asOfAfter, null));
                if (!again.ok()) {
                    return again;
                }
                if (finalStored == null || !finalStored.policyVersion().equals(again.policyVersion())) {
                    continue;
                }
                return done(context, "active", finalStored.policyVersion(), asOfAfter);
            }
            ObjectNode fields = PolicyBodies.fields();
            fields.put("code", "policy-activation-conflict");
            fields.put("reason", "Run policy changed during activation. Retry.");
            fields.put("retryable", true);
            return PolicyBodies.result("conflict", null, fields);
        } catch (RuntimeException | SQLException e) {
            return unavailable();
        }
    }

    /** The version this run has activated, if any; a selected read for later consumers. */
    public Optional<String> activatedPolicyVersion(String environmentId, String runId) {
        try {
            Stored stored = stored(new RunContext(environmentId, runId, ""));
            return stored == null ? Optional.empty() : Optional.of(stored.policyVersion());
        } catch (SQLException | RuntimeException e) {
            return Optional.empty();
        }
    }

    private Outcome store(RunContext context, Stored stored, String version, String asOf) {
        long activationVersion = stored == null ? 0 : stored.version();
        ObjectNode input = PolicyBodies.JSON.objectNode();
        input.put("activationVersion", activationVersion);
        input.put("asOf", asOf);
        input.put("policyVersion", version);
        String commandId = "policy:activate:" + Canonical.digest(input);
        Instant at = Instant.ofEpochMilli(PolicyTime.parse(asOf).getAsLong());
        return database.runner().execute(context, new Command(COMMAND_TYPE, commandId, input), tx -> {
            if (stored == null) {
                if (tx.write("INSERT INTO policy_run_activation (environment_id, run_id, policy_version, as_of) "
                        + "VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", context.environmentId(), context.runId(),
                        version, at) == 0) {
                    throw new TxConflict("stale-version", "The activation changed since it was read");
                }
            } else {
                tx.cas("UPDATE policy_run_activation SET policy_version = ?, as_of = ?, version = version + 1, "
                        + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND version = ?", version, at,
                        context.environmentId(), context.runId(), stored.version());
            }
            return WorkResult.ok(PolicyBodies.JSON.objectNode().put("policyVersion", version).put("asOf", asOf));
        });
    }

    private String runStatus(RunContext context) throws SQLException {
        try (Connection c = database.dataSource().getConnection(); PreparedStatement ps = c.prepareStatement(RUN_STATUS)) {
            ps.setString(1, context.environmentId());
            ps.setString(2, context.runId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private Stored stored(RunContext context) throws SQLException {
        try (Connection c = database.dataSource().getConnection(); PreparedStatement ps = c.prepareStatement(STORED)) {
            ps.setString(1, context.environmentId());
            ps.setString(2, context.runId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? new Stored(rs.getString(1), rs.getLong(2)) : null;
            }
        }
    }

    private static PolicyResult done(RunContext context, String status, String version, String asOf) {
        ObjectNode fields = PolicyBodies.fields();
        ObjectNode value = fields.putObject("value");
        ObjectNode run = value.putObject("run");
        run.put("environmentId", context.environmentId());
        run.put("runId", context.runId());
        run.put("status", status);
        value.put("policyVersion", version);
        value.put("asOf", asOf);
        return PolicyBodies.result("ok", version, fields);
    }

    private static PolicyResult stale() {
        ObjectNode fields = PolicyBodies.fields();
        fields.put("reason", PolicyBodies.STALE_RUN_REASON);
        return PolicyBodies.result("stale-run", null, fields);
    }

    private static PolicyResult unavailable() {
        ObjectNode fields = PolicyBodies.fields();
        fields.put("code", "policy-activation-unavailable");
        fields.put("reason", "The published policy is awaiting run activation.");
        fields.put("retryable", true);
        return PolicyBodies.result("unavailable", null, fields);
    }
}
