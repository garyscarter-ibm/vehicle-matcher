package gcsp.api.cases;

import java.util.Map;

/** The same OIDC identity and ports as {@link CaseHttpProfile}, with persistence switched off. */
public class CaseHttpNoDatabaseProfile extends CaseHttpProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        return noDatabase(identity());
    }
}
