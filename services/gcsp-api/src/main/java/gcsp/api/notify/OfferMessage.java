package gcsp.api.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** A rendered offer email. The record is what a delivery stores and a transport sends; it carries no address. */
public record OfferMessage(Recipient recipient, String subject, String textBody, String htmlBody, String offerLink,
        VehicleImage vehicleImage) {

    public record Recipient(String employeeId, String name) {}

    public record VehicleImage(String src, String alt) {}

    private static final ObjectMapper JSON = new ObjectMapper();

    public ObjectNode toJson() {
        ObjectNode n = JSON.createObjectNode();
        n.putObject("recipient").put("employeeId", recipient.employeeId()).put("name", recipient.name());
        n.put("subject", subject).put("textBody", textBody).put("htmlBody", htmlBody).put("offerLink", offerLink);
        if (vehicleImage != null) n.putObject("vehicleImage").put("src", vehicleImage.src()).put("alt", vehicleImage.alt());
        return n;
    }

    public static OfferMessage fromJson(JsonNode n) {
        JsonNode image = n.path("vehicleImage");
        return new OfferMessage(
                new Recipient(n.path("recipient").path("employeeId").asText(null), n.path("recipient").path("name").asText(null)),
                n.path("subject").asText(null), n.path("textBody").asText(null), n.path("htmlBody").asText(null),
                n.path("offerLink").asText(null),
                image.isObject() ? new VehicleImage(image.path("src").asText(null), image.path("alt").asText(null)) : null);
    }
}
