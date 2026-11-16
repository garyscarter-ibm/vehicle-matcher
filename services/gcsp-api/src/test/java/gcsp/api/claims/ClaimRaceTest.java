package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Real two-connection races: the database, not the application, decides who owns a car or an entitlement. */
class ClaimRaceTest {

    ClaimFixture f;

    @BeforeEach
    void setUp() throws Exception {
        f = ClaimFixture.create();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    @Test
    void twoEmployeesRacingForOneCarLeaveExactlyOneActiveHold() throws Exception {
        for (int i = 0; i < 20; i++) {
            String a = "ea" + i;
            String b = "eb" + i;
            String car = "car-race-" + i;
            f.employee(a);
            f.employee(b);
            f.car(car);
            ManualClaims ca = f.newClaims();
            ManualClaims cb = f.newClaims();
            List<ClaimResult> r = ClaimFixture.race(
                    () -> ca.claim(f.scope(a), f.claimInput(car)),
                    () -> cb.claim(f.scope(b), f.claimInput(car)));
            assertEquals(1, r.stream().filter(x -> x instanceof ClaimResult.Ok).count(), "iteration " + i + ": " + r);
            ClaimResult.Conflict loser = assertInstanceOf(ClaimResult.Conflict.class,
                    r.stream().filter(x -> !(x instanceof ClaimResult.Ok)).findFirst().orElseThrow());
            assertTrue(Set.of("car-held", "stale-version").contains(loser.code()), loser.code());
            assertEquals(1, f.holdsOn(car));
            assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE order_uuid = ?", car));
            assertEquals(2, f.carVersion(car), "stock version bumped once");
            assertEquals(1, f.count("SELECT count(*) FROM manual_claims WHERE order_uuid = ?", car));
        }
    }

    @Test
    void oneEmployeeRacingForTwoCarsHoldsExactlyOne() throws Exception {
        for (int i = 0; i < 10; i++) {
            String e = "eone" + i;
            String c1 = "car-x-" + i;
            String c2 = "car-y-" + i;
            f.employee(e);
            f.car(c1);
            f.car(c2);
            ManualClaims ca = f.newClaims();
            ManualClaims cb = f.newClaims();
            List<ClaimResult> r = ClaimFixture.race(
                    () -> ca.claim(f.scope(e), f.claimInput(c1)),
                    () -> cb.claim(f.scope(e), f.claimInput(c2)));
            assertEquals(1, r.stream().filter(x -> x instanceof ClaimResult.Ok).count(), "iteration " + i + ": " + r);
            ClaimResult.Conflict loser = assertInstanceOf(ClaimResult.Conflict.class,
                    r.stream().filter(x -> !(x instanceof ClaimResult.Ok)).findFirst().orElseThrow());
            assertTrue(Set.of("release-required", "slot-occupied").contains(loser.code()), loser.code());
            assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE employee_id = ?", e));
            assertEquals(1, f.holdsOn(c1) + f.holdsOn(c2));
            assertEquals(3, f.carVersion(c1) + f.carVersion(c2), "only the winning car's version moved");
        }
    }

    @Test
    void aLoserThatArrivesAfterTheWinnerSeesAStaleStockVersion() throws Exception {
        f.employee("e1");
        f.employee("e2");
        f.car("car-1");
        f.claimOk("e1", "car-1");
        JsonNode stale = assertInstanceOf(ClaimResult.Conflict.class,
                f.claims.claim(f.scope("e2"), f.claimInput("car-1"))).extra();
        assertEquals("stock", stale.get("resource").asText());
        assertEquals("1", stale.get("expectedVersion").asText());
        assertEquals("2", stale.get("currentVersion").asText());
        assertEquals(1, f.holdsOn("car-1"));
    }
}
