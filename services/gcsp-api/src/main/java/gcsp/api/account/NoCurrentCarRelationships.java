package gcsp.api.account;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;

/** No Java lifecycle writes current-car relationships yet, so the list is always empty. */
public final class NoCurrentCarRelationships implements CurrentCarPort {

    @Override
    public SourceResult list(AccountScope scope) {
        return SourceResult.ok(JsonNodeFactory.instance.arrayNode());
    }
}
