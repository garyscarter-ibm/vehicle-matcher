package gcsp.api.error;

import io.vertx.ext.web.Router;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Singleton;

/** Last route on the router: any path nothing else handled gets the JSON 404, never HTML. */
@Singleton
public class JsonNotFoundRoute {

    static final String BODY = "{\"status\":\"not-found\",\"code\":\"route-not-found\","
            + "\"reason\":\"No API operation exists at this path.\",\"retryable\":false}";

    void register(@Observes Router router) {
        router.route().order(Integer.MAX_VALUE).handler(ctx -> ctx.response()
                .setStatusCode(404)
                .putHeader("Content-Type", "application/json")
                .end(BODY));
    }
}
