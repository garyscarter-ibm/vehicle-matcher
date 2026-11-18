package gcsp.api.account;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;

/** Used without a database, where no lifecycle can record a relationship, so an empty list is the truthful answer. */
public final class NoCurrentCarRelationships implements CurrentCarPort {

    @Override
    public SourceResult list(AccountScope scope) {
        return SourceResult.ok(JsonNodeFactory.instance.arrayNode());
    }
}
