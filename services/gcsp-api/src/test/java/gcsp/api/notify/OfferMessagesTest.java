package gcsp.api.notify;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class OfferMessagesTest {

    static final Instant NOW = Instant.parse("2026-11-14T10:00:00Z");
    static final Instant EXPIRES = Instant.parse("2026-11-17T11:30:00Z");

    static OfferFacts.Offer offer(String state, Instant expires, String vehicle, Integer points, String image) {
        return new OfferFacts.Offer("off-1", "emp-1", state, expires, vehicle, points, image);
    }

    static OfferMessage render(OfferFacts.Offer o, String name, Optional<URI> base) {
        return OfferMessages.render("emp-1", name, o, "/gcsp/offers/off-1", NOW, base);
    }

    @Test
    void activeOfferHasExactSubjectAndTextLines() {
        OfferMessage m = render(offer("active", EXPIRES, "MINI Cooper S", 1250, null), "Alex Example", Optional.empty());
        assertEquals("Your vehicle offer is ready to review", m.subject());
        assertEquals("Alex, your vehicle offer is ready to review\n\nMINI Cooper S\n\n1,250 points a month\n\n"
                + "Respond by 11:30 on Tuesday 17 November.\n\nReview your offer: /gcsp/offers/off-1", m.textBody());
        assertEquals("emp-1", m.recipient().employeeId());
        assertEquals("Alex Example", m.recipient().name());
        assertEquals("/gcsp/offers/off-1", m.offerLink());
        assertNull(m.vehicleImage());
    }

    @Test
    void deadlineIsLondonLocalTime() {
        OfferMessage m = render(offer("active", Instant.parse("2027-07-01T12:05:00Z"), "Car", null, null), "A B", Optional.empty());
        assertTrue(m.textBody().contains("Respond by 13:05 on Thursday 1 July."), m.textBody());
    }

    @Test
    void expiredOfferUsesExpiredSubjectAndStatus() {
        OfferMessage m = render(offer("active", NOW.minusSeconds(1), "Car", null, null), "Alex Example", Optional.empty());
        assertEquals("Your vehicle offer has expired", m.subject());
        assertTrue(m.textBody().startsWith("Alex, your vehicle offer has expired\n\nCar\n\nThis offer has expired. "
                + "Open your employee account to check its current status.\n\nReview your offer:"), m.textBody());
        assertEquals("Your vehicle offer has expired",
                render(offer("expired", EXPIRES, "Car", null, null), "Alex", Optional.empty()).subject());
    }

    @Test
    void noPointsAndNoFactsVariants() {
        OfferMessage m = render(offer("active", EXPIRES, null, null, null), null, Optional.empty());
        assertEquals("Scheme employee", m.recipient().name());
        assertEquals("Your vehicle offer is ready to review\n\nYour scheme vehicle\n\nRespond by 11:30 on Tuesday 17 November."
                + "\n\nFull vehicle details are not available in this notification. Check the offer in your account."
                + "\n\nReview your offer: /gcsp/offers/off-1", m.textBody());
        assertFalse(m.htmlBody().contains("points a month"));
        assertTrue(m.htmlBody().contains("Full vehicle details are not available"));
    }

    @Test
    void htmlEscapesAndDashesAreReplaced() {
        OfferMessage m = render(offer("active", EXPIRES, "A&B <i>\"x\"</i> 'q' — Z\u0007", 2, null),
                "<b>Al—ex", Optional.empty());
        assertTrue(m.htmlBody().contains("A&amp;B &lt;i&gt;&quot;x&quot;&lt;/i&gt; &#39;q&#39; - Z"), m.htmlBody());
        assertTrue(m.htmlBody().contains("&lt;b&gt;Al-ex, your vehicle offer is ready to review"), m.htmlBody());
        assertFalse(m.htmlBody().contains("<i>"));
        for (String s : new String[] {m.subject(), m.textBody(), m.htmlBody(), m.recipient().name()}) {
            assertFalse(s.indexOf('—') >= 0);
        }
    }

    @Test
    void baseUrlMakesLinkAndImageAbsolute() {
        Optional<URI> base = PublicBase.parse("https://demo.example/app");
        OfferMessage m = render(offer("active", EXPIRES, "Car", 5, "/img/car.png"), "Alex", base);
        assertEquals("https://demo.example/app/gcsp/offers/off-1", m.offerLink());
        assertTrue(m.textBody().endsWith("Review your offer: https://demo.example/app/gcsp/offers/off-1"));
        assertTrue(m.htmlBody().contains("href=\"https://demo.example/app/gcsp/offers/off-1\""));
        assertEquals("https://demo.example/app/img/car.png", m.vehicleImage().src());
        assertEquals("Car", m.vehicleImage().alt());
        assertTrue(m.htmlBody().contains("<img src=\"https://demo.example/app/img/car.png\" alt=\"Car\""));
    }

    @Test
    void relativeImageWithoutBaseAndBadImagePathIsOmitted() {
        assertEquals("/img/car.png", render(offer("active", EXPIRES, "Car", 5, "/img/car.png"), "A", Optional.empty())
                .vehicleImage().src());
        assertNull(render(offer("active", EXPIRES, "Car", 5, "//evil.example/x.png"), "A", Optional.empty()).vehicleImage());
        assertNull(render(offer("active", EXPIRES, "Car", 5, "img/car.png"), "A", Optional.empty()).vehicleImage());
    }

    @Test
    void unsafeInputsAreRejected() {
        OfferFacts.Offer o = offer("active", EXPIRES, "Car", 5, null);
        assertThrows(IllegalArgumentException.class,
                () -> OfferMessages.render("emp-1", "A", o, "//evil.example/x", NOW, Optional.empty()));
        assertThrows(IllegalArgumentException.class,
                () -> OfferMessages.render("emp-1", "A", o, "/a b", NOW, Optional.empty()));
        assertThrows(IllegalArgumentException.class,
                () -> OfferMessages.render("emp-1", "A", offer("active", null, "Car", 5, null), "/x", NOW, Optional.empty()));
    }

    @Test
    void publicBaseValidation() {
        assertEquals("https://demo.example/", PublicBase.parse("https://demo.example").orElseThrow().toString());
        assertEquals("https://demo.example/a/", PublicBase.parse("https://demo.example/a///").orElseThrow().toString());
        for (String bad : new String[] {"http://demo.example", "https://localhost", "https://app.localhost",
            "https://host.local", "https://nodots", "https://127.0.0.1", "https://[::1]/", "https://u:p@demo.example",
            "https://demo.example/?q=1", "https://demo.example/#f", "", " https://demo.example", "demo.example"}) {
            assertTrue(PublicBase.parse(bad).isEmpty(), bad);
        }
        assertTrue(PublicBase.parse(null).isEmpty());
    }

    @Test
    void offerLinkSegmentIsPercentEncoded() {
        assertEquals("a%20b%2Fc", NotificationIntent.segment("a b/c"));
        assertEquals("off-1.2_3~x", NotificationIntent.segment("off-1.2_3~x"));
        assertEquals("%C3%A9%3F%23", NotificationIntent.segment("é?#"));
    }

    @Test
    void retryDelayDoublesAndCaps() {
        DeliveryRules.Rules r = new DeliveryRules.Rules("t", 3, 30, 300);
        assertEquals(30, NotificationDispatcher.delaySeconds(r, 1));
        assertEquals(60, NotificationDispatcher.delaySeconds(r, 2));
        assertEquals(240, NotificationDispatcher.delaySeconds(r, 4));
        assertEquals(300, NotificationDispatcher.delaySeconds(r, 5));
        assertEquals(300, NotificationDispatcher.delaySeconds(r, 500));
    }

    @Test
    void rulesValidation() {
        assertTrue(new DeliveryRules.Rules("t", 3, 30, 300).valid());
        assertFalse(new DeliveryRules.Rules("t", 0, 30, 300).valid());
        assertFalse(new DeliveryRules.Rules("t", 3, 0, 300).valid());
        assertFalse(new DeliveryRules.Rules("t", 3, 30, 29).valid());
        assertFalse(new DeliveryRules.Rules("t", 3, 30, Long.MAX_VALUE).valid());
    }
}
