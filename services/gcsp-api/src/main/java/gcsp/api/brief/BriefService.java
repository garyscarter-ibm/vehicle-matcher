package gcsp.api.brief;

import static gcsp.api.brief.Json.flag;
import static gcsp.api.brief.Json.only;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.brief.BriefResult.Refusal;
import gcsp.api.brief.BriefResult.Refused;
import gcsp.api.brief.BriefStore.BriefRow;
import gcsp.api.brief.BriefStore.DraftRow;
import gcsp.api.brief.BriefStore.Head;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * The employee brief: reads by primary key and commands that each run as one TransactionRunner command (receipt
 * replay, version CAS on brief_heads, outbox). A plain class so it runs without Quarkus; slice 3 wires it to HTTP.
 */
public final class BriefService {

    private enum Kind { SAVE_DRAFT, SAVE_PREFERENCES, CONFIRM, ENGAGE, DISENGAGE, PAUSE, RESUME }

    /** A brief and its pending draft as they stand at one head read. */
    record State(long briefVersion, long draftVersion, BriefRow current, DraftRow draft) {}

    /** The content the editor shows: a matching pending draft, else the current brief, else policy defaults. */
    record Resolved(ObjectNode initial, boolean matching, boolean hasBase, ObjectNode fallback) {}

    /** Everything one command needs besides its transaction. */
    private record Ctx(BriefScope scope, PolicyRules rules, Instant now, Optional<BriefAccountPort.AccountFacts> facts,
            long expectedBrief, long expectedDraft, JsonNode input) {
        String nowText() {
            return now.toString();
        }

        String factsVersion() {
            return facts.map(BriefAccountPort.AccountFacts::factsVersion).orElse(null);
        }
    }

    @FunctionalInterface
    private interface Body {
        JsonNode run(Tx tx, Ctx ctx, State state) throws SQLException;
    }

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final BriefPolicyPort policy;
    private final BriefAccountPort account;
    private final BriefOfferPort offers;
    private final Clock clock;

    public BriefService(DataSource dataSource, BriefPolicyPort policy, BriefAccountPort account, BriefOfferPort offers,
            Clock clock) {
        this.dataSource = dataSource;
        this.runner = new TransactionRunner(dataSource);
        this.policy = policy;
        this.account = account;
        this.offers = offers;
        this.clock = clock;
    }

    // ---- reads: head, then rows by primary key, then the consumed check by the semantic index ----

    /** The current confirmed brief with its activity and validation; not-found before the first confirmation. */
    public BriefResult current(BriefScope scope) {
        return read(scope, (c, rules) -> {
            State s = state(c, scope, false);
            if (s.current() == null) return Refusal.notFound("brief");
            ObjectNode out = Json.obj();
            out.set("brief", briefJson(s.current()));
            out.set("activity", activity(scope, s.current().buddy()));
            out.set("validation", validation(s.current().content(), rules));
            return new BriefResult.Ok(out);
        });
    }

    /** Every confirmed version, oldest first. */
    public BriefResult history(BriefScope scope) {
        return read(scope, (c, rules) -> {
            ArrayNode versions = Json.arr();
            for (BriefRow r : BriefStore.history(c, scope)) versions.add(briefJson(r));
            return new BriefResult.Ok(Json.obj().set("versions", versions));
        });
    }

    /** The latest saved draft; not-found before the first save. */
    public BriefResult draft(BriefScope scope) {
        return read(scope, (c, rules) -> {
            State s = state(c, scope, true);
            if (s.draft() == null) return Refusal.notFound("brief-draft");
            return new BriefResult.Ok(draftJson(s.draft(), scope, rules));
        });
    }

    /** What the editor would open with, its provenance and the current versions. */
    public BriefResult resolveInitial(BriefScope scope) {
        return read(scope, (c, rules) -> {
            State s = state(c, scope, true);
            Resolved r = resolve(c, scope, rules, s, acceptedOffer(scope).isPresent() && s.current() != null);
            ObjectNode out = Json.obj();
            out.set("initial", r.initial());
            out.put("briefVersion", s.briefVersion()).put("draftVersion", s.draftVersion());
            out.put("provenance", r.matching() ? "saved-draft" : s.current() != null ? "approved-brief" : "unconfirmed-policy-defaults");
            return new BriefResult.Ok(out);
        });
    }

    /** The Account editor read: policy-driven context, the content to show, the account-derived views and versions. */
    public BriefResult readEditor(BriefScope scope) {
        return read(scope, (c, rules) -> {
            Optional<BriefAccountPort.AccountFacts> facts = account.facts(scope.environmentId(), scope.runId(), scope.employeeId());
            if (facts.isEmpty()) return Refusal.unavailable();
            State s = state(c, scope, true);
            Optional<BriefOfferPort.Offer> accepted = acceptedOffer(scope);
            Resolved r = resolve(c, scope, rules, s, accepted.isPresent() && s.current() != null);
            JsonNode buddy = s.current() == null ? null : s.current().buddy();
            ObjectNode initial = Json.obj();
            initial.set("brief", r.initial());
            initial.put("briefVersion", s.briefVersion()).put("draftVersion", s.draftVersion());
            initial.set("accountPreferences", AccountEditor.state(r.initial(), rules, facts));
            initial.set("currentCarRating", AccountEditor.rating(r.initial(), facts));
            initial.set("sameAgain", AccountEditor.sameAgain(r.initial(), facts));
            initial.set("buddy", Engagement.view(r.initial(), buddy, rules, facts));
            initial.putObject("consent").put("search", flag(buddy, "searchConsent")).put("hold", flag(buddy, "holdConsent"));
            ObjectNode out = Json.obj();
            out.set("context", AccountEditor.context(rules, facts, clock.instant().truncatedTo(ChronoUnit.MILLIS)));
            out.set("initial", initial);
            out.putObject("versions").put("policy", scope.policyVersion()).put("facts", facts.get().factsVersion());
            if (accepted.isPresent() && s.current() != null) {
                ObjectNode sel = out.putObject("selection").put("state", "accepted");
                if (accepted.get().briefVersion() == null) sel.putNull("briefVersion");
                else sel.put("briefVersion", accepted.get().briefVersion());
            } else {
                out.putNull("selection");
            }
            ObjectNode provenance = out.putObject("provenance");
            provenance.put("initial", r.matching() ? "saved-draft" : s.current() != null ? "approved-brief" : "unconfirmed-policy-defaults");
            if (s.briefVersion() == 0) provenance.putNull("approvedBriefVersion");
            else provenance.put("approvedBriefVersion", s.briefVersion());
            return new BriefResult.Ok(out);
        });
    }

    @FunctionalInterface
    private interface Reader {
        BriefResult read(Connection c, PolicyRules rules) throws SQLException;
    }

    private BriefResult read(BriefScope scope, Reader reader) {
        try {
            Optional<PolicyRules> rules = PolicyRules.load(policy, scope.policyVersion());
            if (rules.isEmpty()) return Refusal.unavailable();
            try (Connection c = dataSource.getConnection()) {
                return reader.read(c, rules.get());
            }
        } catch (Refused r) {
            return r.refusal();
        } catch (PolicyRules.Unavailable | SQLException e) {
            return Refusal.unavailable();
        }
    }

    private static State state(Connection c, BriefScope scope, boolean withDraft) throws SQLException {
        Head head = BriefStore.head(c, scope).orElse(new Head(0, 0));
        BriefRow current = head.briefVersion() > 0 ? BriefStore.brief(c, scope, head.briefVersion()) : null;
        DraftRow draft = withDraft && head.draftVersion() > 0 ? BriefStore.draft(c, scope, head.draftVersion()) : null;
        return new State(head.briefVersion(), head.draftVersion(), current, draft);
    }

    private Resolved resolve(Connection c, BriefScope scope, PolicyRules rules, State s, boolean accepted) throws SQLException {
        ObjectNode fallback = BriefContent.defaults(rules);
        DraftRow draft = s.draft();
        boolean matching = !accepted && draft != null && draft.baseBriefVersion() == s.briefVersion();
        if (draft != null && !matching && !accepted
                && (s.current() == null || !draft.digest().equals(s.current().digest()))) {
            // A draft already confirmed into a later brief version is consumed, not pending.
            boolean consumed = s.current() != null && BriefStore.consumed(c, scope, draft.digest(), draft.baseBriefVersion());
            if (!consumed) throw new Refused(Refusal.staleVersion("brief", draft.baseBriefVersion(), s.briefVersion()));
        }
        ObjectNode initial = matching ? draft.content().deepCopy() : s.current() != null ? s.current().content().deepCopy() : fallback;
        if (BriefContent.validate(initial, rules, false) != null) throw new PolicyRules.Unavailable("Stored brief is invalid");
        return new Resolved(initial, matching, matching || s.current() != null, fallback);
    }

    private Optional<BriefOfferPort.Offer> acceptedOffer(BriefScope scope) {
        for (BriefOfferPort.Offer o : offers.offers(scope.environmentId(), scope.runId(), scope.employeeId())) {
            if ("accepted".equals(o.state())) return Optional.of(o);
        }
        return Optional.empty();
    }

    // ---- commands ----

    /** Saves the whole editable brief as a draft; while search consent is held it also confirms a new brief version. */
    public BriefResult saveDraft(BriefScope scope, JsonNode input) {
        Refusal bad = envelope(input, true, "brief");
        if (bad != null) return bad;
        return command(scope, Kind.SAVE_DRAFT, input, (tx, c, s) -> saveDraftWork(tx, c, s));
    }

    /**
     * The Account editor's sparse category patch, with an optional current-car rating and Same again, saved through
     * the draft path; the response is a readback of what was stored.
     */
    public BriefResult savePreferences(BriefScope scope, JsonNode input) {
        Refusal bad = preferencesEnvelope(input);
        if (bad != null) return bad;
        PolicyRules rules;
        try {
            Optional<PolicyRules> found = PolicyRules.load(policy, scope.policyVersion());
            if (found.isEmpty() || account.facts(scope.environmentId(), scope.runId(), scope.employeeId()).isEmpty()) {
                return Refusal.unavailable();
            }
            rules = found.get();
        } catch (PolicyRules.Unavailable e) {
            return Refusal.unavailable();
        }
        Refusal invalid = AccountEditor.checkChanges(input.get("changes"), rules, input.has("currentCarRating") || input.has("sameAgain"));
        if (invalid != null) return invalid;
        return command(scope, Kind.SAVE_PREFERENCES, input, (tx, c, s) -> savePreferencesWork(tx, c, s));
    }

    private static Refusal preferencesEnvelope(JsonNode input) {
        JsonNode id = input == null ? null : input.get("commandId");
        if (!only(input, "commandId", "expectedBriefVersion", "expectedDraftVersion", "changes", "currentCarRating", "sameAgain")
                || !input.has("changes") || !Json.text(id) || !Json.revision(input.get("expectedBriefVersion"))
                || !Json.revision(input.get("expectedDraftVersion"))) {
            return Refusal.invalid("invalid-preferences", "command", "Supply exactly a command ID, the expected versions and the changes.");
        }
        JsonNode r = input.get("currentCarRating");
        if (input.has("currentCarRating") && !(only(r, "contractId", "value") && r.has("contractId") && r.has("value")
                && Json.text(r.get("contractId")) && (r.get("value").isNull()
                || Json.integer(r.get("value")) && r.get("value").intValue() >= 1 && r.get("value").intValue() <= 5))) {
            return Refusal.invalid("invalid-preferences", "currentCarRating", "Supply exactly the current contract and a 1 to 5 value, or null to clear.");
        }
        JsonNode a = input.get("sameAgain");
        if (input.has("sameAgain") && !(only(a, "contractId", "on") && a.has("contractId") && a.has("on")
                && Json.text(a.get("contractId")) && a.get("on").isBoolean())) {
            return Refusal.invalid("invalid-preferences", "sameAgain", "Supply exactly the current contract and a true or false on.");
        }
        return null;
    }

    /** Confirms the resolved editor content, optionally granting search and hold together. */
    public BriefResult confirm(BriefScope scope, JsonNode input) {
        Refusal bad = envelope(input, false, "consent");
        if (bad != null) return bad;
        JsonNode consent = input.get("consent");
        if (consent != null && (!only(consent, "search", "hold") || !consent.path("search").isBoolean()
                || !consent.path("hold").isBoolean()
                || consent.get("search").booleanValue() != consent.get("hold").booleanValue())) {
            return Refusal.invalid("invalid-command", "consent", "Engage or disengage Buddy as one function.");
        }
        return command(scope, Kind.CONFIRM, input, (tx, c, s) -> confirmWork(tx, c, s));
    }

    public BriefResult engage(BriefScope scope, JsonNode input) {
        return simple(scope, Kind.ENGAGE, input);
    }

    public BriefResult disengage(BriefScope scope, JsonNode input) {
        return simple(scope, Kind.DISENGAGE, input);
    }

    public BriefResult pauseSearch(BriefScope scope, JsonNode input) {
        return simple(scope, Kind.PAUSE, input);
    }

    public BriefResult resumeSearch(BriefScope scope, JsonNode input) {
        return simple(scope, Kind.RESUME, input);
    }

    private BriefResult simple(BriefScope scope, Kind kind, JsonNode input) {
        Refusal bad = envelope(input, false);
        if (bad != null) return bad;
        return command(scope, kind, input, (tx, c, s) -> engagementWork(tx, c, s, kind));
    }

    private static Refusal envelope(JsonNode input, boolean requireExtra, String... extra) {
        String[] fields = new String[3 + extra.length];
        fields[0] = "commandId";
        fields[1] = "expectedBriefVersion";
        fields[2] = "expectedDraftVersion";
        System.arraycopy(extra, 0, fields, 3, extra.length);
        JsonNode id = input == null ? null : input.get("commandId");
        boolean ok = only(input, fields) && id != null && id.isTextual() && !id.asText().isEmpty() && id.asText().length() <= 128
                && Json.revision(input.get("expectedBriefVersion")) && Json.revision(input.get("expectedDraftVersion"))
                && (!requireExtra || extra.length == 0 || input.has(extra[0]));
        return ok ? null : Refusal.invalid("invalid-command", "command",
                "Supply a command ID and the expected brief and draft versions" + (requireExtra ? " and the brief." : "."));
    }

    private BriefResult command(BriefScope scope, Kind kind, JsonNode input, Body body) {
        PolicyRules rules;
        try {
            Optional<PolicyRules> found = PolicyRules.load(policy, scope.policyVersion());
            if (found.isEmpty()) return Refusal.unavailable();
            rules = found.get();
            if (kind == Kind.SAVE_DRAFT) {
                Refusal invalid = BriefContent.validate(input.get("brief"), rules, false);
                if (invalid != null) return invalid;
            }
        } catch (PolicyRules.Unavailable e) {
            return Refusal.unavailable();
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        Optional<BriefAccountPort.AccountFacts> facts = account.facts(scope.environmentId(), scope.runId(), scope.employeeId());
        Ctx ctx = new Ctx(scope, rules, now, facts, input.get("expectedBriefVersion").longValue(),
                input.get("expectedDraftVersion").longValue(), input);
        ObjectNode digestInput = Json.obj();
        digestInput.put("operation", kind.name());
        digestInput.set("input", input);
        Command cmd = new Command("brief." + kind.name().toLowerCase(), input.get("commandId").asText(), digestInput);
        try {
            Outcome outcome = runner.execute(scope.runContext(), cmd, tx -> {
                BriefStore.ensureHead(tx, scope);
                State s = state(tx.connection(), scope, true);
                if (ctx.expectedBrief() != s.briefVersion()) {
                    throw new Refused(Refusal.staleVersion("brief", ctx.expectedBrief(), s.briefVersion()));
                }
                if (ctx.expectedDraft() != s.draftVersion()) {
                    throw new Refused(Refusal.staleVersion("draft", ctx.expectedDraft(), s.draftVersion()));
                }
                JsonNode result = body.run(tx, ctx, s);
                return WorkResult.ok(Json.M.readTree(result.toString()));
            });
            return map(outcome, scope, ctx);
        } catch (Refused r) {
            return r.refusal();
        } catch (PolicyRules.Unavailable e) {
            return Refusal.unavailable();
        }
    }

    private BriefResult map(Outcome outcome, BriefScope scope, Ctx ctx) {
        if (outcome instanceof Outcome.Committed c) return new BriefResult.Ok(c.result(), c.replayed());
        if (outcome instanceof Outcome.Uncertain u) {
            ObjectNode extra = Json.obj().put("operationId", u.operationId());
            return new Refusal(503, "unavailable", "outcome-uncertain",
                    "The save may or may not have completed. Check before trying again.", false, extra);
        }
        if (outcome instanceof Outcome.Unavailable) return Refusal.unavailable();
        if (outcome instanceof Outcome.Refused r) return Refusal.invalid(r.code(), "command", r.message());
        Outcome.Conflict k = (Outcome.Conflict) outcome;
        if ("stale-version".equals(k.code())) {
            // A concurrent writer won the version check; report the versions as they now stand.
            try (Connection c = dataSource.getConnection()) {
                Head h = BriefStore.head(c, scope).orElse(new Head(0, 0));
                boolean brief = ctx.expectedBrief() != h.briefVersion();
                return Refusal.staleVersion(brief ? "brief" : "draft", brief ? ctx.expectedBrief() : ctx.expectedDraft(),
                        brief ? h.briefVersion() : h.draftVersion());
            } catch (SQLException e) {
                return Refusal.unavailable();
            }
        }
        return Refusal.conflict(k.code(), k.message(), null);
    }

    // ---- command bodies ----

    private JsonNode saveDraftWork(Tx tx, Ctx c, State s) throws SQLException {
        readOnlyCheck(c, s);
        return persistDraft(tx, c, s, c.input().get("brief").deepCopy());
    }

    /** Stores content as the next draft; while consent is held it also confirms a version or disengages on minimum loss. */
    private ObjectNode persistDraft(Tx tx, Ctx c, State s, ObjectNode content) throws SQLException {
        BriefScope scope = c.scope();
        Engagement.Gate gate = Engagement.gate(content, c.rules(), c.facts());
        long draftVersion = s.draftVersion() + 1;
        DraftRow draft = new DraftRow(draftVersion, s.briefVersion(), content, BriefContent.semanticDigest(content),
                scope.policyVersion(), c.factsVersion(), scope.principalId(), c.now());
        // While consent is held an autosave is also a confirmed version, so the search never runs on older choices.
        boolean confirms = s.current() != null && flag(s.current().buddy(), "searchConsent");
        BriefRow brief = null;
        String transition = null;
        if (confirms) {
            c.rules().engagement();
            ObjectNode confirmed = BriefContent.confirmed(content, c.rules(), c.nowText());
            if (gate.ok()) {
                brief = newBrief(c, s, "preferences-updated", confirmed, s.current().buddy().deepCopy());
            } else {
                transition = "minimum-lost";
                brief = newBrief(c, s, "disengaged", confirmed,
                        disengagedBuddy(s.current().buddy(), s.briefVersion() + 1, c.now(), transition));
            }
        }
        BriefStore.casHead(tx, scope, new Head(s.briefVersion(), s.draftVersion()),
                new Head(brief == null ? s.briefVersion() : brief.version(), draftVersion), c.now());
        BriefStore.insertDraft(tx, scope, draft);
        tx.emit("brief-draft:" + scope.employeeId() + ":" + draftVersion, "brief-draft-saved", Json.obj()
                .put("employeeId", scope.employeeId()).put("draftVersion", draftVersion).put("baseBriefVersion", s.briefVersion()));
        if (brief != null) store(tx, scope, brief);
        ObjectNode out = draftJson(draft, scope, c.rules());
        if (brief != null) out.set("confirmed", Json.obj().put("briefVersion", brief.version()).put("transition", transition));
        return out;
    }

    private JsonNode savePreferencesWork(Tx tx, Ctx c, State s) throws SQLException {
        JsonNode in = c.input();
        if (c.facts().isEmpty()) throw new Refused(Refusal.unavailable());
        readOnlyCheck(c, s);
        BriefAccountPort.CurrentContract car = c.facts().get().currentContract();
        String carId = car == null ? null : car.contractId();
        for (String field : List.of("currentCarRating", "sameAgain")) {
            if (!in.has(field)) continue;
            if (carId == null || carId.isBlank()) throw new Refused(carConflict("no-current-car", "There is no current car to use.", null));
            if ("sameAgain".equals(field) && (car.model() == null || car.model().isBlank())) {
                throw new Refused(carConflict("current-car-unidentified", "The current car has no model, so Same again is unavailable.", null));
            }
            if (!carId.equals(in.get(field).get("contractId").asText())) {
                throw new Refused(carConflict("current-car-changed", "The current car is no longer the one shown.", carId));
            }
        }
        Resolved resolved = resolve(tx.connection(), c.scope(), c.rules(), s, false);
        boolean on = resolved.hasBase() && AccountEditor.sameAgain(resolved.initial(), c.facts()).path("on").booleanValue();
        JsonNode changes = in.get("changes");
        if (on && !changes.isEmpty() && !(in.has("sameAgain") && !in.get("sameAgain").get("on").booleanValue())) {
            throw new Refused(Refusal.invalid("invalid-preferences", "changes", "Turn off Same again to change your categories."));
        }
        // A new employee starts sparse: policy essentials stay unconfirmed and no default preference is invented.
        ObjectNode merged = resolved.hasBase() ? resolved.initial().deepCopy() : resolved.fallback().deepCopy();
        if (!resolved.hasBase()) merged.set("preferences", Json.obj());
        Refusal orphan = AccountEditor.applyChanges(merged, changes, c.rules());
        if (orphan != null) throw new Refused(orphan);
        if (in.has("currentCarRating")) {
            ObjectNode r = merged.putObject("currentCarRating");
            r.set("value", in.get("currentCarRating").get("value"));
            r.put("contractId", carId).put("source", "employee").put("ratedAt", c.nowText());
        }
        if (in.has("sameAgain")) {
            ObjectNode a = merged.putObject("sameAgain");
            a.put("on", in.get("sameAgain").get("on").booleanValue()).put("contractId", carId).put("source", "employee").put("setAt", c.nowText());
        }
        if (BriefContent.validate(merged, c.rules(), false) != null) {
            throw new Refused(Refusal.invalid("invalid-preferences", "changes", "Use the registered editable brief."));
        }
        ObjectNode saved = persistDraft(tx, c, s, merged);
        // The response is read back from the rows just written, in the same transaction.
        State after = state(tx.connection(), c.scope(), true);
        Resolved shown = resolve(tx.connection(), c.scope(), c.rules(), after, false);
        JsonNode buddy = after.current() == null ? null : after.current().buddy();
        ObjectNode out = Json.obj();
        out.put("briefVersion", after.briefVersion()).put("draftVersion", after.draftVersion());
        out.set("buddy", Engagement.view(shown.initial(), buddy, c.rules(), c.facts()));
        JsonNode transition = saved.path("confirmed").path("transition");
        if (transition.isTextual()) out.put("buddyTransition", transition.asText());
        else out.putNull("buddyTransition");
        out.set("accountPreferences", AccountEditor.state(shown.initial(), c.rules(), c.facts()));
        out.set("currentCarRating", AccountEditor.rating(shown.initial(), c.facts()));
        out.set("sameAgain", AccountEditor.sameAgain(shown.initial(), c.facts()));
        return out;
    }

    private static Refusal carConflict(String code, String reason, String currentContractId) {
        ObjectNode extra = null;
        if (currentContractId != null) {
            extra = Json.obj();
            extra.putObject("current").put("contractId", currentContractId);
        }
        return Refusal.conflict(code, reason, extra);
    }

    private JsonNode confirmWork(Tx tx, Ctx c, State s) throws SQLException {
        if (s.draft() == null && s.current() == null) throw new Refused(Refusal.notFound("brief-draft"));
        readOnlyCheck(c, s);
        Resolved r = resolve(tx.connection(), c.scope(), c.rules(), s, false);
        Engagement.Gate gate = Engagement.gate(r.initial(), c.rules(), c.facts());
        ObjectNode content = BriefContent.confirmed(r.initial(), c.rules(), c.nowText());
        long version = s.briefVersion() + 1;
        JsonNode consent = c.input().get("consent");
        boolean search = consent != null && consent.get("search").booleanValue();
        boolean hold = consent != null && consent.get("hold").booleanValue();
        if (search) {
            PolicyRules.Grants grants = c.rules().engagement();
            if (!gate.ok()) throw new Refused(Engagement.refusal(gate));
            search = grants.search();
            hold = grants.hold();
        }
        ObjectNode buddy = Json.obj();
        buddy.put("enabled", search).put("searchConsent", search).put("holdConsent", hold).put("paused", false);
        buddy.put("permissionVersion", version).put("confirmedBy", c.scope().principalId()).put("confirmedAt", c.nowText());
        BriefRow brief = newBrief(c, s, "confirmed", content, buddy);
        bump(tx, c, s, brief, s.draftVersion());
        ObjectNode out = Json.obj();
        out.set("brief", briefJson(brief));
        out.set("activity", activity(c.scope(), brief.buddy()));
        out.set("validation", validation(brief.content(), c.rules()));
        out.set("event", eventJson(c, brief));
        return out;
    }

    private JsonNode engagementWork(Tx tx, Ctx c, State s, Kind kind) throws SQLException {
        BriefScope scope = c.scope();
        long version = s.briefVersion() + 1;
        boolean pending = s.draft() != null && s.draft().baseBriefVersion() == s.briefVersion();
        if (kind == Kind.ENGAGE && s.current() == null && !pending) throw new Refused(Refusal.notFound("brief"));
        if ((kind == Kind.PAUSE || kind == Kind.RESUME) && s.current() == null) throw new Refused(Refusal.notFound("brief"));
        readOnlyCheck(c, s);
        JsonNode currentBuddy = s.current() == null ? null : s.current().buddy();
        if (kind == Kind.ENGAGE && Engagement.engaged(currentBuddy)) throw new Refused(conflict(tx.connection(), c, s, "already-engaged"));
        boolean canRevoke = flag(currentBuddy, "searchConsent") || flag(currentBuddy, "holdConsent") || flag(currentBuddy, "paused");
        if (kind == Kind.DISENGAGE && !canRevoke) throw new Refused(conflict(tx.connection(), c, s, "already-disengaged"));
        Resolved resolved = resolve(tx.connection(), scope, c.rules(), s, false);
        String operation;
        ObjectNode content;
        ObjectNode buddy;
        switch (kind) {
            case ENGAGE -> {
                // A pending draft is the latest saved brief; otherwise the current confirmed brief is copied.
                content = pending ? BriefContent.confirmed(resolved.initial(), c.rules(), c.nowText()) : s.current().content().deepCopy();
                PolicyRules.Grants grants = c.rules().engagement();
                Engagement.Gate gate = Engagement.gate(resolved.initial(), c.rules(), c.facts());
                if (!gate.ok()) throw new Refused(Engagement.refusal(gate));
                operation = "engaged";
                buddy = Json.obj();
                buddy.put("enabled", grants.search()).put("searchConsent", grants.search()).put("holdConsent", grants.hold());
                buddy.put("paused", false).put("permissionVersion", version).put("engagedBy", scope.principalId());
                buddy.put("engagedAt", c.nowText()).put("confirmedBy", scope.principalId()).put("confirmedAt", c.nowText());
            }
            case DISENGAGE -> {
                content = pending ? BriefContent.confirmed(resolved.initial(), c.rules(), c.nowText()) : s.current().content().deepCopy();
                operation = "disengaged";
                buddy = disengagedBuddy(currentBuddy, version, c.now(), null);
            }
            default -> {
                boolean pausing = kind == Kind.PAUSE;
                if (!pausing) {
                    Engagement.Gate gate = Engagement.gate(resolved.initial(), c.rules(), c.facts());
                    if (!gate.ok()) throw new Refused(Engagement.refusal(gate));
                }
                if (pausing && !flag(currentBuddy, "searchConsent")) throw new Refused(conflict(tx.connection(), c, s, "not-engaged"));
                if (flag(currentBuddy, "paused") == pausing) throw new Refused(conflict(tx.connection(), c, s, pausing ? "already-paused" : "already-resumed"));
                content = s.current().content().deepCopy();
                operation = pausing ? "paused" : "resumed";
                buddy = currentBuddy.deepCopy();
                buddy.put("paused", pausing).put("permissionVersion", version).put(pausing ? "pausedAt" : "resumedAt", c.nowText());
            }
        }
        BriefRow brief = newBrief(c, s, operation, content, buddy);
        bump(tx, c, s, brief, s.draftVersion());
        ObjectNode out = Json.obj();
        out.put("briefVersion", brief.version()).put("draftVersion", s.draftVersion()).put("operation", operation);
        out.set("buddy", Engagement.view(brief.content(), brief.buddy(), c.rules(), c.facts()));
        out.set("event", eventJson(c, brief));
        return out;
    }

    // ---- shared pieces ----

    private void readOnlyCheck(Ctx c, State s) {
        if (acceptedOffer(c.scope()).isPresent()) {
            ObjectNode extra = Json.obj();
            extra.putObject("current").put("briefVersion", s.briefVersion());
            throw new Refused(Refusal.conflict("brief-read-only", "An accepted offer makes the brief read-only.", extra));
        }
    }

    /** A conflict carrying the current version and, when a readback can be computed, the engagement view to show. */
    private Refusal conflict(Connection conn, Ctx c, State s, String code) {
        ObjectNode extra = Json.obj();
        extra.putObject("current").put("briefVersion", s.briefVersion());
        try {
            Resolved r = resolve(conn, c.scope(), c.rules(), s, false);
            extra.set("buddy", Engagement.view(r.initial(), s.current() == null ? null : s.current().buddy(), c.rules(), c.facts()));
        } catch (Refused | PolicyRules.Unavailable | SQLException e) {
            // No view without a computable readback; the conflict itself still stands.
        }
        return Refusal.conflict(code, "The request conflicts with the current Buddy state: " + code + ".", extra);
    }

    private static BriefRow newBrief(Ctx c, State s, String operation, ObjectNode content, ObjectNode buddy) {
        return new BriefRow(s.briefVersion() + 1, s.briefVersion() == 0 ? null : s.briefVersion(), operation, content, buddy,
                BriefContent.semanticDigest(content), c.scope().policyVersion(), c.factsVersion(), c.scope().principalId(), c.now());
    }

    private static ObjectNode disengagedBuddy(JsonNode current, long version, Instant now, String reason) {
        ObjectNode b = current != null && current.isObject() ? ((ObjectNode) current).deepCopy() : Json.obj();
        b.remove("disengagedReason");
        b.put("enabled", false).put("searchConsent", false).put("holdConsent", false).put("paused", false);
        b.put("permissionVersion", version).put("disengagedAt", now.toString());
        if (reason != null) b.put("disengagedReason", reason);
        return b;
    }

    /** CAS the head to the new brief version, then insert the version and its outbox event. */
    private static void bump(Tx tx, Ctx c, State s, BriefRow brief, long draftVersion) throws SQLException {
        BriefStore.casHead(tx, c.scope(), new Head(s.briefVersion(), s.draftVersion()), new Head(brief.version(), draftVersion), c.now());
        store(tx, c.scope(), brief);
    }

    private static void store(Tx tx, BriefScope scope, BriefRow brief) throws SQLException {
        BriefStore.insertBrief(tx, scope, brief);
        ObjectNode payload = Json.obj();
        payload.put("operation", brief.operation()).put("briefVersion", brief.version());
        if (brief.previousVersion() == null) payload.putNull("previousBriefVersion");
        else payload.put("previousBriefVersion", brief.previousVersion());
        payload.put("employeeId", scope.employeeId());
        tx.emit("brief:" + scope.employeeId() + ":" + brief.version(), "brief-changed", payload);
    }

    private static ObjectNode eventJson(Ctx c, BriefRow brief) {
        ObjectNode e = Json.obj();
        e.put("eventType", "brief-changed").put("operation", brief.operation()).put("employeeId", c.scope().employeeId());
        e.put("briefVersion", brief.version());
        if (brief.previousVersion() == null) e.putNull("previousBriefVersion");
        else e.put("previousBriefVersion", brief.previousVersion());
        e.put("occurredAt", c.nowText());
        return e;
    }

    private static ObjectNode briefJson(BriefRow r) {
        ObjectNode b = r.content().deepCopy();
        b.put("briefVersion", r.version());
        if (r.previousVersion() == null) b.putNull("previousBriefVersion");
        else b.put("previousBriefVersion", r.previousVersion());
        b.put("status", "confirmed").put("operation", r.operation());
        b.set("buddy", r.buddy().deepCopy());
        b.put("policyVersion", r.policyVersion()).put("confirmedBy", r.confirmedBy()).put("confirmedAt", r.confirmedAt().toString());
        if (r.accountFactsVersion() == null) b.putNull("accountFactsVersion");
        else b.put("accountFactsVersion", r.accountFactsVersion());
        return b;
    }

    private static ObjectNode draftJson(DraftRow d, BriefScope scope, PolicyRules rules) {
        ObjectNode o = Json.obj();
        o.put("employeeId", scope.employeeId()).put("draftVersion", d.version()).put("baseBriefVersion", d.baseBriefVersion());
        o.set("brief", d.content().deepCopy());
        o.set("validation", validation(d.content(), rules));
        o.put("policyVersion", d.policyVersion()).put("savedBy", d.savedBy()).put("savedAt", d.savedAt().toString());
        return o;
    }

    private static ObjectNode validation(JsonNode content, PolicyRules rules) {
        ObjectNode v = Json.obj();
        v.put("policyVersion", rules.policyVersion);
        v.set("unknownEssentials", BriefContent.unknownEssentials(content));
        ArrayNode assumptions = v.putArray("assumptions");
        rules.assumptions.forEach(a -> assumptions.add(a.deepCopy()));
        return v;
    }

    /** Search and hold flags from the confirmed brief; existing offers are never changed by the brief. */
    private ObjectNode activity(BriefScope scope, JsonNode buddy) {
        boolean engaged = Engagement.engaged(buddy);
        ObjectNode a = Json.obj();
        a.put("canSearch", engaged).put("canHold", engaged).put("existingOffersUnaffected", true);
        ArrayNode list = a.putArray("existingOffers");
        List<BriefOfferPort.Offer> found = offers.offers(scope.environmentId(), scope.runId(), scope.employeeId());
        for (BriefOfferPort.Offer o : found) {
            ObjectNode n = list.addObject().put("offerId", o.offerId()).put("state", o.state());
            if (o.briefVersion() == null) n.putNull("briefVersion");
            else n.put("briefVersion", o.briefVersion());
        }
        return a;
    }
}
