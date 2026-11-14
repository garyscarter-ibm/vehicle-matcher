package gcsp.api.notify;

import java.util.Set;

/** The only transport failure codes the dispatcher will store; anything else becomes transport-unavailable. */
public final class MailFailureCodes {

    public static final String TRANSPORT_UNAVAILABLE = "transport-unavailable";

    public static final Set<String> TRANSPORT = Set.of("mail-configuration-invalid", "recipient-not-allowed",
            "recipient-email-invalid", "offer-link-invalid", "provider-authentication", "provider-rejected",
            "provider-rate-limited", "provider-unavailable", "provider-timeout", "provider-unconfirmed",
            "provider-window-expired", TRANSPORT_UNAVAILABLE);

    private MailFailureCodes() {}
}
