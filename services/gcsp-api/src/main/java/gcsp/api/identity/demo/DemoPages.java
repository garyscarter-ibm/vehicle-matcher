package gcsp.api.identity.demo;

import java.net.URI;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** The sign-in page and the plain error page of the demo issuer: server-rendered HTML, no scripts, all text escaped. */
final class DemoPages {

    static final String TITLE = "Demo sign-in. Fictional people only.";
    static final String CSS_PATH = DemoIssuerSettings.ISSUER_PATH + "/demo-idp.css";

    private DemoPages() {}

    static String signIn(DemoIssuerSettings settings, List<DemoPerson> people, String txn) {
        StringBuilder b = head(TITLE);
        b.append("<main class=\"card\"><h1>").append(esc(TITLE)).append("</h1>")
                .append("<p>Choose who to sign in as. No password is needed.</p>")
                .append("<form method=\"post\" action=\"").append(esc(settings.endpoint("/authorize"))).append("\">")
                .append("<input type=\"hidden\" name=\"txn\" value=\"").append(esc(txn)).append("\">")
                .append("<ul class=\"people\">");
        for (DemoPerson p : people) {
            b.append("<li><button class=\"person\" type=\"submit\" name=\"subject\" value=\"")
                    .append(esc(p.principalId())).append("\" data-subject=\"").append(esc(p.principalId())).append("\">")
                    .append("<span class=\"name\">").append(esc(p.name())).append("</span>")
                    .append("<span class=\"role\">").append(esc(roleWords(p.roles()))).append("</span>")
                    .append("</button></li>");
        }
        return b.append("</ul></form></main></body></html>").toString();
    }

    static String error(String message) {
        StringBuilder b = head("Demo sign-in could not continue");
        return b.append("<main class=\"card\"><h1>Demo sign-in could not continue</h1><p>").append(esc(message))
                .append("</p><p>Close this page and start again from the demo.</p></main></body></html>").toString();
    }

    /** Plain words for a person's roles, as the page shows them. */
    static String roleWords(List<String> roles) {
        boolean employee = roles.contains("employee");
        if (roles.contains("greg")) {
            return employee ? "Ordering lead and employee" : "Ordering lead";
        }
        if (roles.contains("presenter")) {
            return "Presenter";
        }
        return employee ? "Employee" : String.join(", ", roles);
    }

    /** form-action must list the redirect origins too, because Chrome applies it to the redirect after a submit. */
    static String csp(DemoIssuerSettings settings) {
        Set<String> origins = new LinkedHashSet<>();
        origins.add("'self'");
        for (String uri : settings.redirectUris()) {
            URI u = URI.create(uri);
            origins.add(u.getScheme() + "://" + u.getRawAuthority());
        }
        return "default-src 'none'; style-src 'self'; form-action " + String.join(" ", origins)
                + "; frame-ancestors 'none'; base-uri 'none'";
    }

    private static StringBuilder head(String title) {
        return new StringBuilder("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>").append(esc(title))
                .append("</title><link rel=\"stylesheet\" href=\"").append(CSS_PATH).append("\"></head><body>");
    }

    static String esc(String s) {
        StringBuilder b = new StringBuilder(s.length() + 16);
        for (char c : s.toCharArray()) {
            switch (c) {
                case '&' -> b.append("&amp;");
                case '<' -> b.append("&lt;");
                case '>' -> b.append("&gt;");
                case '"' -> b.append("&quot;");
                case '\'' -> b.append("&#39;");
                default -> b.append(c);
            }
        }
        return b.toString();
    }
}
