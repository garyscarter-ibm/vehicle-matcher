package gcsp.api.notify;

import java.net.URI;
import java.util.Optional;

/** Validates the public base URL used to make offer links and images absolute (as brevo.js publicMailBase). */
public final class PublicBase {

    private PublicBase() {}

    /** An https URL with a dotted public host, no userinfo, query or fragment; the path always ends with '/'. */
    public static Optional<URI> parse(String value) {
        if (value == null || value.isEmpty() || !value.equals(value.strip())
                || value.chars().anyMatch(c -> Character.isWhitespace(c) || Character.isISOControl(c) || c == '\\')) {
            return Optional.empty();
        }
        try {
            URI uri = new URI(value);
            String host = uri.getHost() == null ? null : uri.getHost().toLowerCase(java.util.Locale.ROOT);
            if (!"https".equals(uri.getScheme()) || host == null || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getRawAuthority() == null
                    || host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local")
                    || !host.contains(".") || host.matches("[\\d.]+") || host.contains(":") || host.contains("[")) {
                return Optional.empty();
            }
            String path = uri.getRawPath() == null ? "" : uri.getRawPath();
            String origin = "https://" + (uri.getPort() >= 0 ? host + ":" + uri.getPort() : host);
            return Optional.of(new URI(origin + path.replaceAll("/+$", "") + "/"));
        } catch (java.net.URISyntaxException e) {
            return Optional.empty();
        }
    }
}
