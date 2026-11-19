package gcsp.api.identity.demo;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.scenario.DemoPreparationFile;
import java.util.ArrayList;
import java.util.List;

/** A fictional demo person the sign-in page offers: the scenario directory's principal id, employee id, name and roles. */
public record DemoPerson(String principalId, String employeeId, String name, List<String> roles) {

    public static List<DemoPerson> from(DemoPreparationFile file) {
        List<DemoPerson> out = new ArrayList<>();
        for (JsonNode d : file.directory()) {
            List<String> roles = new ArrayList<>();
            d.path("roles").forEach(r -> roles.add(r.asText()));
            out.add(new DemoPerson(d.path("principalId").asText(), d.path("employeeId").asText(),
                    d.path("name").asText(), List.copyOf(roles)));
        }
        return List.copyOf(out);
    }
}
