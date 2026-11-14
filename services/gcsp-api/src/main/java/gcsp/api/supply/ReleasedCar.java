package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;

/** A released stock car as the allocator reads it; occupied means an occupying custody hold exists. */
public record ReleasedCar(String orderUuid, String configurationId, long version, JsonNode attributes,
        boolean occupied) {}
