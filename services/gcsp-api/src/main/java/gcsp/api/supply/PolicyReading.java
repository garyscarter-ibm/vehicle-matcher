package gcsp.api.supply;

/** The release policy at one instant: all three values from one policy version, or unavailable. Never a default. */
public sealed interface PolicyReading {

    record Ok(String policyVersion, int releaseSize, int leadTimeDays, int stockSourceMaxAgeMinutes)
            implements PolicyReading {}

    record Unavailable(String reason) implements PolicyReading {}
}
