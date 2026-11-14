package gcsp.api.notify;

import java.net.URI;
import java.text.NumberFormat;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Optional;

/** Renders the offer email, word for word as server/gcsp/notify/templates.js renderOfferMessage. */
public final class OfferMessages {

    private static final DateTimeFormatter DEADLINE = DateTimeFormatter
            .ofPattern("HH:mm 'on' EEEE d MMMM", Locale.UK).withZone(ZoneId.of("Europe/London"));
    private static final String OFFER_PATH = "/gcsp/offers/";
    private static final String FALLBACK_VEHICLE = "Your scheme vehicle";
    private static final String MISSING_FACTS =
            "Full vehicle details are not available in this notification. Check the offer in your account.";

    private OfferMessages() {}

    /** Relative offerLink in, absolute when a validated base is present; unsafe inputs throw IllegalArgumentException. */
    public static OfferMessage render(String employeeId, String employeeName, OfferFacts.Offer offer, String offerLink,
            Instant now, Optional<URI> base) {
        if (employeeId == null || offer == null || offer.expiresAt() == null || now == null || !safeLink(offerLink)) {
            throw new IllegalArgumentException("Offer message inputs are unavailable");
        }
        String link = absoluteLink(offerLink, base);
        String fullName = copy(employeeName);
        String name = fullName.isEmpty() ? "Scheme employee" : fullName;
        String firstName = fullName.isEmpty() ? "" : fullName.split("\\s+")[0];
        String vehicleCopy = copy(offer.vehicleName());
        String vehicle = vehicleCopy.isEmpty() ? FALLBACK_VEHICLE : vehicleCopy;
        OfferMessage.VehicleImage image = image(offer.imagePath(), vehicle, base);
        String points = offer.monthlyPoints() != null && offer.monthlyPoints() >= 0
                ? NumberFormat.getIntegerInstance(Locale.UK).format(offer.monthlyPoints()) + " points a month" : "";
        boolean expired = !offer.expiresAt().isAfter(now) || "expired".equals(offer.state());
        String subject = expired ? "Your vehicle offer has expired" : "Your vehicle offer is ready to review";
        String heading = firstName.isEmpty() ? subject
                : firstName + ", " + Character.toLowerCase(subject.charAt(0)) + subject.substring(1);
        String status = expired ? "This offer has expired. Open your employee account to check its current status."
                : "Respond by " + DEADLINE.format(offer.expiresAt()) + ".";
        String missing = vehicleCopy.isEmpty() ? MISSING_FACTS : "";

        StringBuilder text = new StringBuilder();
        for (String part : new String[] {heading, vehicle, points, status, missing}) {
            if (!part.isEmpty()) text.append(part).append("\n\n");
        }
        text.append("Review your offer: ").append(link);

        String photo = image == null ? "" : "<img src=\"" + escape(image.src()) + "\" alt=\"" + escape(image.alt())
                + "\" width=\"600\" style=\"display:block;width:100%;max-width:600px;height:auto;border:0;margin:16px 0\">";
        String summary = "<div style=\"background:#fff;border:1px solid #dcdee1;padding:16px;margin:16px 0 24px\">"
                + (points.isEmpty() ? "" : "<p style=\"margin:0 0 16px;font-size:20px;font-weight:bold\">"
                        + escape(points) + "</p>")
                + "<p style=\"margin:0;" + (points.isEmpty() ? "" : "border-top:1px solid #dcdee1;padding-top:16px;")
                + "\">" + escape(status) + "</p></div>";
        String action = "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:24px 0\">"
                + "<tr><td bgcolor=\"#037493\"><a style=\"display:inline-block;padding:12px 24px;border:1px solid #037493;"
                + "background:#037493;color:#fff;font-weight:bold;text-decoration:none\" href=\"" + escape(link)
                + "\">View offer</a></td></tr></table>";
        String html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + subject
                + "</title></head><body style=\"margin:0;background:#f5f6f6;color:#1f2328;font-family:Arial,sans-serif;"
                + "line-height:1.6\"><main style=\"max-width:600px;margin:0 auto;padding:24px;background:#fff;"
                + "overflow-wrap:anywhere\"><p style=\"font-size:14px;color:#4e545d\">GCSP employee vehicle scheme</p>"
                + "<h1 style=\"font-size:26px;line-height:1.25\">" + escape(heading) + "</h1>" + photo
                + "<h2 style=\"font-size:20px\">" + escape(vehicle) + "</h2>" + summary
                + (missing.isEmpty() ? "" : "<p>" + escape(missing) + "</p>") + action
                + "<p style=\"font-size:12px;color:#4e545d\">If you cannot use the button, copy this address:</p>"
                + "<p style=\"font-size:12px;word-break:break-all\">" + escape(link) + "</p></main></body></html>";
        return new OfferMessage(new OfferMessage.Recipient(employeeId, name), subject, text.toString(), html, link, image);
    }

    /** Control characters to space, U+2014 to '-', trimmed; null is empty. */
    static String copy(String value) {
        if (value == null) return "";
        StringBuilder sb = new StringBuilder(value.length());
        for (char ch : value.toCharArray()) {
            sb.append(ch <= 0x1f || ch == 0x7f ? ' ' : ch == '\u2014' ? '-' : ch);
        }
        return sb.toString().strip();
    }

    static String escape(String value) {
        StringBuilder sb = new StringBuilder();
        for (char ch : copy(value).toCharArray()) {
            switch (ch) {
                case '&' -> sb.append("&amp;");
                case '<' -> sb.append("&lt;");
                case '>' -> sb.append("&gt;");
                case '"' -> sb.append("&quot;");
                case '\'' -> sb.append("&#39;");
                default -> sb.append(ch);
            }
        }
        return sb.toString();
    }

    /** A site-relative path (one leading '/') or an https URL without userinfo; no spaces, controls or backslashes. */
    static boolean safeLink(String value) {
        if (value == null || value.isEmpty() || !value.equals(value.strip())
                || value.chars().anyMatch(c -> c <= 0x20 || c == 0x7f || c == '\\')) return false;
        if (value.startsWith("/") && !value.startsWith("//")) return true;
        try {
            URI u = new URI(value);
            return "https".equals(u.getScheme()) && u.getRawUserInfo() == null && u.getHost() != null;
        } catch (java.net.URISyntaxException e) {
            return false;
        }
    }

    private static String absoluteLink(String link, Optional<URI> base) {
        return base.isPresent() && link.startsWith(OFFER_PATH) ? base.get() + link.substring(1) : link;
    }

    private static OfferMessage.VehicleImage image(String path, String alt, Optional<URI> base) {
        if (path == null || !path.startsWith("/") || path.startsWith("//") || path.contains("..")
                || path.chars().anyMatch(c -> c <= 0x20 || c == 0x7f || c == '\\' || c == '"')) return null;
        return new OfferMessage.VehicleImage(base.isPresent() ? base.get() + path.substring(1) : path, alt);
    }
}
