package gcsp.api.policy;

import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/** The instant a publication or activation treats as now. A later story supplies the presenter demo clock. */
public interface PolicyClock {

    DateTimeFormatter ISO_MILLIS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    Instant now(RunContext context);

    /** The instant as the ISO text the policy documents use, truncated to milliseconds. */
    static String iso(Instant instant) {
        return ISO_MILLIS.format(instant);
    }
}
