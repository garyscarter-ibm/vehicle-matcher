package gcsp.api.auth;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.identity.Principal;
import java.util.List;
import org.junit.jupiter.api.Test;

class AccessTest {

    private static Principal p(String employeeId, String... roles) {
        return new Principal("s", List.of(roles), "env", "run", employeeId, "pv", List.of());
    }

    @Test
    void requireAnyRolePassesAndFails() {
        assertDoesNotThrow(() -> Access.requireAnyRole(p(null, "greg"), Role.GREG, Role.PRESENTER));
        IdentityRefusal e = assertThrows(IdentityRefusal.class,
                () -> Access.requireAnyRole(p("E-1", "employee"), Role.GREG, Role.PRESENTER));
        assertEquals(403, e.http());
        assertEquals("role-required", e.code());
        assertEquals("forbidden", e.status());
        assertEquals("Your account cannot use this action.", e.reason());
    }

    @Test
    void employeeOwnsOnlyTheirOwnResources() {
        Principal a = p("E-1001", "employee");
        assertTrue(Access.owns(a, "E-1001"));
        assertFalse(Access.owns(a, "E-1002"));
        assertFalse(Access.owns(a, null));
        assertDoesNotThrow(() -> Access.requireOwner(a, "E-1001"));
        IdentityRefusal e = assertThrows(IdentityRefusal.class, () -> Access.requireOwner(a, "E-1002"));
        assertEquals("not-resource-owner", e.code());
        assertEquals(403, e.http());
    }

    @Test
    void presenterAndGregNeverOwn() {
        assertFalse(Access.owns(p(null, "presenter"), "E-1001"));
        assertFalse(Access.owns(p("E-1001", "presenter"), "E-1001"));
        assertFalse(Access.owns(p(null, "greg"), "E-1001"));
        assertThrows(IdentityRefusal.class, () -> Access.requireOwner(p(null, "greg"), "E-1001"));
    }

    @Test
    void nullOwnerIsNeverOwned() {
        assertFalse(Access.owns(p(null, "employee"), null));
        assertThrows(IdentityRefusal.class, () -> Access.requireOwner(p("E-1", "employee"), null));
    }

    @Test
    void roleWireNamesRoundTrip() {
        assertEquals(Role.GREG, Role.fromWire("greg").orElseThrow());
        assertTrue(Role.fromWire("admin").isEmpty());
        assertEquals(List.of("account:read"), Role.EMPLOYEE.capabilities());
    }
}
