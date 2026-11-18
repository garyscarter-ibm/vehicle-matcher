package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** The preview version name is Node's inputDigest of the same input: the expected hex came from server/gcsp/repository/core.js. */
class GregPolicyPreviewDigestTest {

    private static final String INPUT = "{\"changes\":[{\"unit\":\"points-per-month\",\"after\":107,\"before\":100,\"id\":\"price:abc\"},"
            + "{\"id\":\"weight:body\",\"before\":1,\"after\":3,\"unit\":\"relative-weight\"},"
            + "{\"id\":\"price:é\\\"q\",\"before\":0,\"after\":9007199254740991}],\"activeVersion\":\"gcsp-policy-v1\"}";

    @Test
    void policyDigestMatchesNodeInputDigest() throws Exception {
        assertEquals("c3fb34c593db781cec1e5c09e37553d6c912ec1d098847e9a9630abc29aabfc3",
                PolicyDigest.of(new ObjectMapper().readTree(INPUT)));
    }
}
