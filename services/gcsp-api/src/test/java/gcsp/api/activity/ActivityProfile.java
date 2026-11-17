package gcsp.api.activity;

import gcsp.api.offers.GeneratedClaimRemoteOfferProfile;
import java.util.Map;

/** The generated-claim remote-offer application, with one more employee, a Greg and a presenter account. */
public class ActivityProfile extends GeneratedClaimRemoteOfferProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = super.getConfigOverrides();
        c.put("gcsp.oidc.accounts", "["
                + "{\"subject\":\"sub-employee-a\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
                + "{\"subject\":\"sub-employee-b\",\"roles\":[\"employee\"],\"employeeId\":\"E-1002\"},"
                + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
                + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]");
        return c;
    }
}
