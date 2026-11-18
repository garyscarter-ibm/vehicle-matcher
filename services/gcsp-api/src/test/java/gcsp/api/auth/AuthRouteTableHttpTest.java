package gcsp.api.auth;

import static gcsp.api.auth.AuthSupport.API;
import static gcsp.api.auth.AuthSupport.call;
import static gcsp.api.auth.AuthSupport.code;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PATCH;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Stream;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** FUCQ-455 AC1: every registered JAX-RS route refuses no bearer with 401 and a wrong role with 403, over real RS256 JWTs. */
@QuarkusTest
@TestProfile(AuthRouteTableProfile.class)
class AuthRouteTableHttpTest {

    private static final String E = "employee";
    private static final String G = "greg";
    private static final String P = "presenter";
    private static final Set<String> ROLES = Set.of(E, G, P);

    /** Route (METHOD plus full path template) to the roles allowed, taken from each resource's requireAnyRole calls. */
    private static final Map<String, Set<String>> TABLE = new TreeMap<>();

    private static void allow(String methodAndPaths, String... roles) {
        String[] parts = methodAndPaths.split(" ", 2);
        for (String path : parts[1].split(",")) TABLE.put(parts[0] + " " + API + path.trim(), Set.of(roles));
    }

    static {
        // Employee-own: role and owner come from the token, never the request.
        allow("GET /brief,/brief/history,/brief/draft,/brief/editor", E);
        allow("POST /brief/draft,/brief/preferences,/brief/preview,/brief/confirm,/brief/change-after-decline,"
                + "/brief/engage,/brief/disengage,/brief/pause,/brief/resume,/brief/pause-search,/brief/resume-search", E);
        allow("GET /offers/current,/offers/{offerId},/offers/{offerId}/decision-reasons,/offers/{offerId}/follow-up", E);
        allow("POST /offers/{offerId}/decision", E);
        allow("GET /offer-followup", E);
        allow("POST /offer-followup/confirm", E);
        allow("GET /documents", E);
        allow("POST /documents/tasks/acknowledge,/documents/tasks/complete", E);
        allow("POST /return-plan/request,/return-plan/accept", E);
        allow("GET /manual/account,/manual/draft,/manual/claim,/manual/quote,/manual/review-details,/manual/stock,"
                + "/manual/order,/manual/order/terms,/manual/notification-email", E);
        allow("POST /manual/draft,/manual/draft/discard,/manual/claim,/manual/claim/review,/manual/claim/release,"
                + "/manual/review-details,/manual/order,/manual/notification-email", E);
        allow("GET /cases,/help,/activity", E);
        allow("POST /cases,/recommendations", E);
        allow("POST /appointments/request,/appointments/accept", E);
        // Greg: scheme team, order plan, policy, demand, orders and production requests.
        allow("GET /greg/order-plan,/greg/policy,/greg/demand,/greg/orders,/scheme-team/cases,/scheme-team/cases/options", G);
        allow("POST /greg/order-plan/preview,/greg/policy/preview,/greg/policy/publish,/greg/orders,/greg/orders/queue,"
                + "/greg/production/requests,/scheme-team/cases/update,/comparison/jobs,"
                + "/appointments/complete,/appointments/no-show", G);
        // Greg and the presenter inspect read-only; only Greg commands.
        allow("GET /comparison/jobs/latest,/comparison/results/latest,/comparison/process/latest,/greg/production,"
                + "/greg/production/supply-activity", G, P);
        // Presenter: clock, controls, scenarios, faults, releases, outbox, suitability, ticks and reconcile.
        allow("GET /presenter/clock,/presenter/clock/ticks/{tickId},/presenter/controls,/presenter/scenarios,"
                + "/presenter/scenarios/current,/presenter/scenarios/faults,/presenter/outbox,/presenter/suitability,"
                + "/presenter/releases/latest,/presenter/releases/ticks/{tickId},/presenter/releases/stock", P);
        allow("POST /presenter/clock/advance,/presenter/clock/tick,/presenter/clock/reset,/presenter/controls/tick,"
                + "/presenter/scenarios/reset,/presenter/scenarios/faults,/presenter/releases/ticks,"
                + "/presenter/releases/reconcile,/presenter/appointments/ticks,/presenter/approvals/ticks,"
                + "/presenter/approvals/reconcile,/presenter/ordering/reconcile,/presenter/production,"
                + "/presenter/production/responses,/presenter/production/reconcile,/presenter/returns/progress", P);
        // Shared reads: every mapped role may read, and each is still scoped by its own token.
        allow("GET /orders/progress,/orders/progress/all,/documents/readiness,/return-plan,/appointments,"
                + "/vehicle-evidence/{rest:.*},/vehicle-images/{file},/context", E, G, P);
    }

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    private String employee;
    private String greg;
    private String presenter;
    private String paula;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        employee = AuthSupport.token(signingJwk, "sub-employee-a", E);
        greg = AuthSupport.token(signingJwk, "sub-greg", G);
        presenter = AuthSupport.token(signingJwk, "sub-presenter", P);
        paula = AuthSupport.token(signingJwk, "sub-paula", E);
    }

    /** METHOD plus full path template for every resource method the app's own classes register. */
    private Set<String> discover() throws IOException {
        Path root = Path.of("target/classes");
        assertTrue(Files.isDirectory(root.resolve("gcsp/api")), "target/classes is missing; run from services/gcsp-api");
        Set<String> found = new TreeSet<>();
        List<String> unloadable = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root.resolve("gcsp/api"))) {
            for (Path f : (Iterable<Path>) files.filter(x -> x.toString().endsWith(".class"))::iterator) {
                String name = root.relativize(f).toString().replace('/', '.').replaceAll("\\.class$", "");
                Class<?> type;
                try {
                    type = Class.forName(name, false, getClass().getClassLoader());
                } catch (ClassNotFoundException | LinkageError e) {
                    unloadable.add(name);
                    continue;
                }
                jakarta.ws.rs.Path classPath = type.getAnnotation(jakarta.ws.rs.Path.class);
                if (classPath == null) continue;
                for (Method m : type.getDeclaredMethods()) {
                    String verb = verb(m);
                    if (verb == null) continue;
                    jakarta.ws.rs.Path methodPath = m.getAnnotation(jakarta.ws.rs.Path.class);
                    String path = join(classPath.value(), methodPath == null ? "" : methodPath.value());
                    found.add(verb + " " + path);
                }
            }
        }
        assertTrue(unloadable.isEmpty(), "classes that could not be inspected: " + unloadable);
        return found;
    }

    private static String verb(Method m) {
        if (m.isAnnotationPresent(GET.class)) return "GET";
        if (m.isAnnotationPresent(POST.class)) return "POST";
        if (m.isAnnotationPresent(PUT.class)) return "PUT";
        if (m.isAnnotationPresent(DELETE.class)) return "DELETE";
        if (m.isAnnotationPresent(PATCH.class)) return "PATCH";
        return null;
    }

    private static String join(String base, String sub) {
        String joined = ("/" + base + "/" + sub).replaceAll("/+", "/");
        return joined.length() > 1 && joined.endsWith("/") ? joined.substring(0, joined.length() - 1) : joined;
    }

    private static String concrete(String template) {
        return template.replaceAll("\\{[^}]*\\}", "x");
    }

    /** The offer decision checks its body before the role, so it gets a well-formed decline; the rest take {}. */
    private static final String DECLINE = "{\"commandId\":\"cmd-1\",\"decision\":\"decline\",\"reasonCode\":\"size\","
            + "\"runId\":\"run-1\",\"expectedQuoteVersion\":1,\"expectedOfferVersion\":4,\"expectedHoldVersion\":2}";

    private static Response hit(String token, String route) {
        String[] parts = route.split(" ", 2);
        String body = !"POST".equals(parts[0]) ? null : route.endsWith("/decision") ? DECLINE : "{}";
        return call(token, parts[0], concrete(parts[1]), body);
    }

    @Test
    void theTableMatchesTheRegisteredRoutesExactly() throws IOException {
        Set<String> found = discover();
        Set<String> unlisted = new TreeSet<>(found);
        unlisted.removeAll(TABLE.keySet());
        Set<String> gone = new TreeSet<>(TABLE.keySet());
        gone.removeAll(found);
        assertTrue(unlisted.isEmpty() && gone.isEmpty(),
                "routes without a table entry: " + unlisted + "; table entries with no route: " + gone);
        System.out.println("AUTH-ROUTES registered=" + found.size() + " table=" + TABLE.size());
    }

    @Test
    void everyRouteRefusesNoBearerAndEveryWrongRole() throws Exception {
        String stranger = AuthSupport.token(signingJwk, "sub-stranger", E);
        Map<String, String> tokens = Map.of(E, employee, G, greg, P, presenter);
        List<String> mismatches = new ArrayList<>();
        for (Map.Entry<String, Set<String>> route : TABLE.entrySet()) {
            Response none = hit(null, route.getKey());
            if (none.statusCode() != 401 || !"bearer-missing".equals(code(none))) {
                mismatches.add(route.getKey() + " no bearer: expected 401 bearer-missing, got " + none.statusCode() + " " + code(none));
            }
            if (route.getValue().containsAll(ROLES)) {
                Response unmapped = hit(stranger, route.getKey());
                if (unmapped.statusCode() != 403 || !"subject-not-mapped".equals(code(unmapped))) {
                    mismatches.add(route.getKey() + " unmapped subject: expected 403 subject-not-mapped, got "
                            + unmapped.statusCode() + " " + code(unmapped));
                }
                continue;
            }
            for (String role : ROLES) {
                if (route.getValue().contains(role)) continue;
                Response wrong = hit(tokens.get(role), route.getKey());
                String c = code(wrong);
                if (wrong.statusCode() != 403 || !("role-required".equals(c) || "not-resource-owner".equals(c))) {
                    mismatches.add(route.getKey() + " as " + role + ": expected 403 role-required/not-resource-owner, got "
                            + wrong.statusCode() + " " + c);
                }
            }
        }
        System.out.println("AUTH-ROUTES mismatches=" + mismatches.size());
        assertTrue(mismatches.isEmpty(), mismatches.size() + " route mismatches:\n" + String.join("\n", mismatches));
    }

    @Test
    void oneAllowedCallPerFamilyIsNotRefused() {
        List<String> statuses = new ArrayList<>();
        List<String> refused = new ArrayList<>();
        for (String r : List.of("brief", "offers/current", "documents", "return-plan", "manual/account", "manual/draft")) {
            record(statuses, refused, "employee", call(paula, "GET", API + "/" + r, null), r);
        }
        for (String r : List.of("greg/order-plan", "comparison/jobs/latest", "comparison/results/latest")) {
            record(statuses, refused, "greg", call(greg, "GET", API + "/" + r, null), r);
        }
        for (String r : List.of("comparison/jobs/latest", "comparison/results/latest")) {
            record(statuses, refused, "presenter", call(presenter, "GET", API + "/" + r, null), r);
        }
        for (String r : List.of("presenter/clock", "presenter/outbox", "presenter/scenarios/faults", "presenter/scenarios/current")) {
            record(statuses, refused, "presenter", call(presenter, "GET", API + "/" + r, null), r);
        }
        assertEquals(List.of(), refused, "allowed calls that were refused");
        // Inspection is read-only: the presenter may read comparison results but not start a job.
        assertEquals(403, call(presenter, "POST", API + "/comparison/jobs", "{}").statusCode());
        System.out.println("AUTH-ROUTES positive " + statuses);
    }

    private static void record(List<String> statuses, List<String> refused, String role, Response r, String route) {
        statuses.add(role + " GET /" + route + "=" + r.statusCode());
        if (r.statusCode() == 401 || r.statusCode() == 403) refused.add(role + " GET /" + route + " " + r.statusCode() + " " + code(r));
    }
}
