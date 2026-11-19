package gcsp.api.identity.demo;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.FormParam;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jose4j.jwa.AlgorithmConstraints;
import org.jose4j.jwk.JsonWebKeySet;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jwt.JwtClaims;
import org.jose4j.jwt.MalformedClaimException;
import org.jose4j.jwt.consumer.InvalidJwtException;
import org.jose4j.jwt.consumer.JwtConsumerBuilder;
import org.jose4j.keys.resolvers.JwksVerificationKeyResolver;
import org.jose4j.lang.JoseException;

/** The demo issuer's HTTP surface under /demo-idp. Every path is a 404 unless the issuer is switched on. */
@Path(DemoIssuerSettings.ISSUER_PATH)
public class DemoIdpResource {

    private static final String CSS = loadCss();

    @Inject
    DemoIssuer issuer;

    @Inject
    DemoGrants grants;

    @GET
    @Path("/.well-known/openid-configuration")
    @Produces(MediaType.APPLICATION_JSON)
    public Response discovery() {
        if (!issuer.enabled()) return notFound();
        DemoIssuerSettings s = issuer.settings();
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("issuer", s.issuer());
        doc.put("authorization_endpoint", s.endpoint("/authorize"));
        doc.put("token_endpoint", s.endpoint("/token"));
        doc.put("jwks_uri", s.endpoint("/jwks"));
        doc.put("end_session_endpoint", s.endpoint("/end-session"));
        doc.put("response_types_supported", List.of("code"));
        doc.put("grant_types_supported", List.of("authorization_code", "refresh_token"));
        doc.put("code_challenge_methods_supported", List.of("S256"));
        doc.put("token_endpoint_auth_methods_supported", List.of("none"));
        doc.put("subject_types_supported", List.of("public"));
        doc.put("id_token_signing_alg_values_supported", List.of("RS256"));
        doc.put("scopes_supported", Arrays.asList(s.scope().split(" ")));
        return Response.ok(doc).build();
    }

    @GET
    @Path("/jwks")
    @Produces(MediaType.APPLICATION_JSON)
    public Response jwks() {
        if (!issuer.enabled()) return notFound();
        return Response.ok(issuer.keys().jwksJson()).build();
    }

    @GET
    @Path("/demo-idp.css")
    @Produces("text/css")
    public Response css() {
        if (!issuer.enabled()) return notFound();
        return Response.ok(CSS).header("X-Content-Type-Options", "nosniff").header("Cache-Control", "public, max-age=3600")
                .build();
    }

    @GET
    @Path("/authorize")
    @Produces(MediaType.TEXT_HTML)
    public Response authorize(@QueryParam("client_id") String clientId, @QueryParam("redirect_uri") String redirectUri,
            @QueryParam("response_type") String responseType, @QueryParam("scope") String scope,
            @QueryParam("state") String state, @QueryParam("nonce") String nonce,
            @QueryParam("code_challenge") String challenge,
            @QueryParam("code_challenge_method") String challengeMethod) {
        if (!issuer.enabled()) return notFound();
        DemoIssuerSettings s = issuer.settings();
        if (!s.clientId().equals(clientId)) {
            return page(400, DemoPages.error("This sign-in request names an unknown application."));
        }
        if (redirectUri == null || !s.redirectUris().contains(redirectUri)) {
            return page(400, DemoPages.error("This sign-in request names a return address that is not registered."));
        }
        boolean valid = "code".equals(responseType) && "S256".equals(challengeMethod) && !blank(challenge)
                && !blank(state) && hasScope(scope, "openid");
        if (!valid) {
            return redirect(withQuery(redirectUri, "error=invalid_request" + stateParam(state)));
        }
        Optional<String> txn = grants.openTxn(redirectUri, challenge, state, nonce);
        if (txn.isEmpty()) {
            return page(503, DemoPages.error("Too many sign-ins are waiting. Try again in a few minutes."));
        }
        return page(200, DemoPages.signIn(s, issuer.people(), txn.get()));
    }

    @POST
    @Path("/authorize")
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    @Produces(MediaType.TEXT_HTML)
    public Response choose(@FormParam("txn") String txnId, @FormParam("subject") String subject) {
        if (!issuer.enabled()) return notFound();
        Optional<DemoGrants.Txn> txn = grants.peekTxn(txnId);
        if (txn.isEmpty()) {
            return page(400, DemoPages.error("This sign-in has expired or was already used."));
        }
        boolean known = subject != null && issuer.people().stream().anyMatch(p -> p.principalId().equals(subject));
        if (!known) {
            return page(400, DemoPages.error("That person is not one of the demo people."));
        }
        if (!grants.spendTxn(txnId, txn.get())) {
            return page(400, DemoPages.error("This sign-in has expired or was already used."));
        }
        DemoSessions.Session session = issuer.sessions().start(subject);
        String code = grants.mintCode(issuer.settings().clientId(), txn.get(), subject, session);
        return redirect(withQuery(txn.get().redirectUri(), "code=" + enc(code) + stateParam(txn.get().state())));
    }

    @POST
    @Path("/token")
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    @Produces(MediaType.APPLICATION_JSON)
    public Response token(@FormParam("grant_type") String grantType, @FormParam("client_id") String clientId,
            @FormParam("code") String code, @FormParam("redirect_uri") String redirectUri,
            @FormParam("code_verifier") String verifier, @FormParam("refresh_token") String refreshToken) {
        if (!issuer.enabled()) return notFound();
        if (!issuer.settings().clientId().equals(clientId)) {
            return tokenError("invalid_client");
        }
        if ("authorization_code".equals(grantType)) {
            return fromCode(code, redirectUri, verifier);
        }
        if ("refresh_token".equals(grantType)) {
            return fromRefresh(refreshToken);
        }
        return tokenError("unsupported_grant_type");
    }

    @GET
    @Path("/end-session")
    @Produces(MediaType.TEXT_HTML)
    public Response endSession(@QueryParam("id_token_hint") String hint,
            @QueryParam("post_logout_redirect_uri") String postLogout, @QueryParam("state") String state) {
        if (!issuer.enabled()) return notFound();
        DemoIssuerSettings s = issuer.settings();
        Optional<String> sid = sessionOf(hint);
        if (sid.isEmpty()) {
            return page(400, DemoPages.error("The sign-out request does not carry a valid sign-in token."));
        }
        if (postLogout == null || !s.postLogoutRedirectUris().contains(postLogout)) {
            return page(400, DemoPages.error("The sign-out request names a return address that is not registered."));
        }
        issuer.sessions().end(sid.get());
        return redirect(blank(state) ? postLogout : withQuery(postLogout, "state=" + enc(state)));
    }

    private Response fromCode(String code, String redirectUri, String verifier) {
        Optional<DemoGrants.Code> taken = grants.takeCode(code);
        if (taken.isEmpty()) return tokenError("invalid_grant");
        DemoGrants.Code c = taken.get();
        if (!c.clientId().equals(issuer.settings().clientId()) || !c.redirectUri().equals(redirectUri)
                || !DemoGrants.pkceMatches(verifier, c.challenge())) {
            return tokenError("invalid_grant");
        }
        Optional<DemoPerson> person = person(c.subject());
        if (person.isEmpty()) return tokenError("invalid_grant");
        String refresh = issuer.sessions().issueRefreshToken(c.sessionId());
        return tokens(person.get(), c.sessionId(), c.authTime(), c.nonce(), refresh);
    }

    private Response fromRefresh(String refreshToken) {
        if (blank(refreshToken)) return tokenError("invalid_grant");
        Optional<DemoSessions.Renewal> renewal = issuer.sessions().redeem(refreshToken);
        if (renewal.isEmpty()) return tokenError("invalid_grant");
        DemoSessions.Session session = renewal.get().session();
        Optional<DemoPerson> person = person(session.subject());
        if (person.isEmpty()) return tokenError("invalid_grant");
        return tokens(person.get(), session.id(), session.authTime(), null, renewal.get().refreshToken());
    }

    private Response tokens(DemoPerson person, String sessionId, Instant authTime, String nonce,
            String refreshToken) {
        DemoTokens t = issuer.tokens();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("access_token", t.accessToken(person.principalId(), person.roles()));
        body.put("token_type", "Bearer");
        body.put("expires_in", t.accessTokenExpiresInSeconds());
        body.put("scope", issuer.settings().scope());
        body.put("id_token", t.idToken(person.principalId(), person.name(), sessionId, authTime, nonce));
        body.put("refresh_token", refreshToken);
        return Response.ok(body).header("Cache-Control", "no-store").header("Pragma", "no-cache").build();
    }

    /** The session id inside an id token this issuer signed; an expired token is fine, a foreign or forged one is not. */
    private Optional<String> sessionOf(String hint) {
        if (blank(hint)) return Optional.empty();
        try {
            JsonWebKeySet keys = new JsonWebKeySet(issuer.keys().jwksJson());
            JwtClaims claims = new JwtConsumerBuilder().setSkipAllValidators()
                    .setVerificationKeyResolver(new JwksVerificationKeyResolver(keys.getJsonWebKeys()))
                    .setJwsAlgorithmConstraints(AlgorithmConstraints.ConstraintType.PERMIT,
                            AlgorithmIdentifiers.RSA_USING_SHA256)
                    .build().processToClaims(hint);
            DemoIssuerSettings s = issuer.settings();
            String sid = claims.getClaimValueAsString("sid");
            boolean ours = s.issuer().equals(claims.getIssuer()) && claims.getAudience().contains(s.clientId());
            return ours && !blank(sid) ? Optional.of(sid) : Optional.empty();
        } catch (InvalidJwtException | MalformedClaimException | JoseException | RuntimeException e) {
            return Optional.empty();
        }
    }

    private Optional<DemoPerson> person(String principalId) {
        return issuer.people().stream().filter(p -> p.principalId().equals(principalId)).findFirst();
    }

    /** same-origin, not no-referrer: no-referrer makes Chrome post the person form with Origin: null, which CORS refuses. */
    private Response page(int status, String html) {
        return Response.status(status).type("text/html;charset=UTF-8").entity(html)
                .header("Content-Security-Policy", DemoPages.csp(issuer.settings()))
                .header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "same-origin")
                .header("Cache-Control", "no-store").build();
    }

    private static Response tokenError(String error) {
        return Response.status(400).entity(Map.of("error", error)).type(MediaType.APPLICATION_JSON)
                .header("Cache-Control", "no-store").header("Pragma", "no-cache").build();
    }

    private static Response redirect(String location) {
        return Response.status(302).location(URI.create(location)).header("Cache-Control", "no-store")
                .header("Referrer-Policy", "no-referrer").build();
    }

    private static Response notFound() {
        return Response.status(404).build();
    }

    private static String withQuery(String uri, String query) {
        return uri + (uri.contains("?") ? "&" : "?") + query;
    }

    private static String stateParam(String state) {
        return blank(state) ? "" : "&state=" + enc(state);
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static boolean hasScope(String scope, String wanted) {
        return scope != null && Arrays.asList(scope.trim().split("\\s+")).contains(wanted);
    }

    private static String loadCss() {
        try (InputStream in = DemoIdpResource.class.getResourceAsStream("/gcsp/demo-idp/demo-idp.css")) {
            if (in == null) throw new IllegalStateException("The demo sign-in stylesheet is missing");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("The demo sign-in stylesheet could not be read");
        }
    }
}
