package gcsp.api.supply;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Exact native port of modelBrowseFacts in server/gcsp/stock/demo-provider.js. */
final class GeneratedStockBrowseFacts {
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private record Model(String key, String body, String fuel, int boot, int size, int insurance,
            String tags, double acceleration, Double mpg, int seats) {}
    private static final Model[] MODELS = {
        m("G20 Saloon|320i", "saloon", "petrol", 480, 2, 30, "cruiser", 7.4, 45.0),
        m("G21 Touring|320i", "estate", "petrol", 500, 2, 30, "family", 7.4, 44.0),
        m("G61 i5|i5 40", "estate", "ev", 490, 3, 35, "electric", 6.1, null),
        m("F70 Sports Hatch|120", "hatchback", "petrol", 380, 1, 22, "city", 7.8, 48.7),
        m("F70 Sports Hatch|M135", "hatchback", "petrol", 380, 1, 36, "sporty", 4.9, 34.4),
        new Model("G42 Coupe|220i", "coupe", "petrol", 390, 1, 29, "sporty", 7.5, 41.5, 4),
        new Model("G42 Coupe|230i", "coupe", "petrol", 390, 1, 33, "sporty", 5.9, 40.4, 4),
        new Model("G42 Coupe|M240i", "coupe", "petrol", 390, 1, 42, "sporty", 4.3, 35.3, 4),
        m("G21 Touring|330e", "estate", "phev", 410, 2, 32, "family", 6.0, 37.7),
        m("G21 Touring|M340i", "estate", "petrol", 500, 2, 44, "family,sporty", 4.5, 36.7),
        m("U11 X1|18d", "suv", "diesel", 540, 2, 25, "family", 8.9, 52.3),
        m("U11 X1|20i", "suv", "petrol", 540, 2, 24, "family", 8.3, 46.3),
        m("U11 X1|23d", "suv", "diesel", 540, 2, 28, "family", 7.4, 56.5),
        m("U11 X1|23i", "suv", "petrol", 540, 2, 29, "family", 7.1, 41.5),
        m("U11 X1|25e", "suv", "phev", 490, 2, 30, "family", 6.8, 43.5),
        m("U11 X1|30e", "suv", "phev", 490, 2, 31, "family", 5.6, 43.5),
        m("U11 X1|M35i", "suv", "petrol", 540, 2, 38, "family,sporty", 5.4, 35.8),
        m("U11 iX1|iX1 20", "suv", "ev", 490, 2, 30, "electric", 8.6, null),
        m("U11 iX1|iX1 30", "suv", "ev", 490, 2, 33, "electric", 5.6, null),
        m("U10 X2|20i", "suv", "petrol", 470, 2, 27, "family", 8.3, 44.8),
        m("U10 X2|M35i", "suv", "petrol", 470, 2, 38, "sporty", 5.4, 34.4),
        m("U10 iX2|iX2 20", "suv", "ev", 525, 2, 31, "electric", 8.6, null),
        m("U10 iX2|iX2 30", "suv", "ev", 525, 2, 34, "electric", 5.6, null),
        m("G26 i4|i4 35", "coupe", "ev", 470, 2, 41, "electric", 6.0, null),
        m("G26 i4|i4 40", "coupe", "ev", 470, 2, 44, "electric", 5.6, null)
    };

    private GeneratedStockBrowseFacts() {}

    private static Model m(String key, String body, String fuel, int boot, int size, int insurance,
            String tags, double acceleration, Double mpg) {
        return new Model(key, body, fuel, boot, size, insurance, tags, acceleration, mpg, 5);
    }

    static ObjectNode forKey(String key) {
        ObjectNode out = F.objectNode();
        for (Model model : MODELS) {
            if (!model.key().equals(key)) continue;
            fact(out, "body", F.textNode(model.body()), null);
            fact(out, "fuel", F.textNode(model.fuel()), null);
            fact(out, "seats", F.numberNode(model.seats()), "count");
            fact(out, "boot", F.numberNode(model.boot()), "L");
            fact(out, "sizeClass", F.numberNode(model.size()), "ordinal-1-5");
            fact(out, "zeroTo62", number(model.acceleration()), "s");
            fact(out, "insuranceGroup", F.numberNode(model.insurance()), "insurance-group");
            var tags = F.arrayNode();
            for (String tag : model.tags().split(",")) tags.add(tag);
            fact(out, "tags", tags, null);
            if (model.mpg() != null) fact(out, "mpg", number(model.mpg()), "mpg-imperial");
            break;
        }
        return out;
    }

    private static com.fasterxml.jackson.databind.JsonNode number(double value) {
        return value == Math.rint(value) ? F.numberNode((int) value) : F.numberNode(value);
    }

    private static void fact(ObjectNode out, String key, com.fasterxml.jackson.databind.JsonNode value, String unit) {
        ObjectNode fact = out.putObject(key);
        fact.set("value", value);
        fact.put("unit", unit);
    }
}
