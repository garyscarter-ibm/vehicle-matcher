# FUCQ-481 ordering provider bindings: 17 November 2026

This note covers the startup component `OrderingProviderBindings`, its connection to the ordering selector, holder and configuration, and the tests of both. It changes no screen.

There are two stages:

1. **Component (assignment 19).** Authored from `00f600dcd` (API tree matches integration `461049f73`) and committed as `0f9a547b7`. The parent ran `-Dtest=OrderingProviderBindingsTest`: **8 passed, 0 failures, errors or skips**. It was independently reviewed (PASS) and integrated as `f0f3cff25`.
2. **Connection (assignment 20).** Authored from `0f9a547b7`. The Russell lane released `OrderingSelection.java`, `OrderingServiceHolder.java` and the ordering keys of `application.properties` to F481 at 10:40 UTC (`dispatcher-learnings.md` at `c9bd31efa`). **The stage 2 edits and both stage 2 tests below are authored and not compiled or run.** The stage 1 pass applies only to `0f9a547b7`.

With stage 2, `gcsp.ordering.provider=remote` is selectable at application startup.

## The component

`services/gcsp-api/src/main/java/gcsp/api/ordering/OrderingProviderBindings.java`, `@ApplicationScoped @Startup`.

- **`init()`** (`@PostConstruct`) reads `OrderingSelection.provider()` once and calls `configure(...)`. Plain loopback HTTP is allowed only when `LaunchMode` is `TEST`, as in `RemoteOperationProviders`. It logs only the mode, never an endpoint or the token.
- **`configure(mode, executeUrl, reconcileUrl, token, timeout, loopbackHttpAllowed)`**, package-visible and static, is where every refusal can be tested.
  - Blank means `none`. `none` and `synthetic` capture the mode only, with no client.
  - `remote` runs `OperationHttpTransport.Settings.parse("gcsp.ordering", ...)` eagerly, builds one client with `OperationHttpTransport.newClient(settings.timeout())` and one `HttpOrderingProvider` over them. No request is sent.
  - Any other value, including `Remote` or `live`, throws `Unknown gcsp.ordering.provider '<v>'; supported: none, synthetic, remote`.
  - Bad remote settings throw the existing `Settings.parse` message, which names keys only.
- **`provider(DataSource)`** is what the Holder will pass to `OrderingService`.
  - `none` and `synthetic` delegate to the unchanged `OrderingProviderSelection.select(mode, dataSource)` with the caller's datasource.
  - `remote` returns the same captured adapter every time.
- **`mode()`** returns the captured mode.
- **`close()`** (`@PreDestroy`) calls `HttpClient.shutdownNow()` (Java 21) on the owned client.
  - After that, `provider` refuses with `IllegalStateException` rather than hand out a dead port.
  - An aborted in-flight call surfaces as UNKNOWN. `OrderingService` already keeps an UNKNOWN pending and reconciles it later.

There is no new provider key, no fallback to `none` when remote is unusable, no static registry and no new dependency. Business, core, terms and freeze code are untouched.

## Configuration boundary

`application.properties` now carries these keys (stage 2). Nothing else in that file changed.

| Key | Type | Default |
|---|---|---|
| `gcsp.ordering.provider` | `none`, `synthetic`, `remote`, from `GCSP_ORDERING_PROVIDER` | `none`, read by `OrderingSelection` |
| `gcsp.ordering.execute-url` | `Optional<String>`, https (loopback http in TEST only), from `GCSP_ORDERING_EXECUTE_URL` | blank |
| `gcsp.ordering.reconcile-url` | as above, no query, from `GCSP_ORDERING_RECONCILE_URL` | blank |
| `gcsp.ordering.token` | `Optional<String>`, visible ASCII, from `GCSP_ORDERING_TOKEN` | blank |
| `gcsp.ordering.timeout` | `Duration`, above 0 and at most 60s, from `GCSP_ORDERING_TIMEOUT` | `10s` |

No real endpoint, secret or deployment setting was added.

With `none` or `synthetic` the URL keys are not read for validation, so the component boots harmlessly under every existing profile.

## The connection (stage 2)

1. **`OrderingSelection`** adds `REMOTE` (the same value as `OrderingProviderBindings.REMOTE`), and `validate` accepts it.
   - Blank still means `none`, and only one selection is made at startup.
   - `Remote`, `live` and every other value still stop startup. The message now lists `none, synthetic, remote`.
   - The existing `OrderingSelectionTest` assertions are unchanged and still hold.
2. **`OrderingServiceHolder`** injects `OrderingProviderBindings bindings`. In `service()`, `OrderingProviderSelection.select(selection.provider(), ds)` becomes `bindings.provider(ds)`.
   - `provider()`, lazy construction, the Agroal datasource, `OrderingTerms`, the clock, the freeze adapter and all business rules are unchanged.
   - `none` and `synthetic` still reach the same `OrderingProviderSelection` through the bindings.
3. **`application.properties`** adds one comment line and the four keys above.

`OrderingResource`, `OrderingStartup` and `SelectionOrderTickHandler` compare `holder.provider()` with `none` only, so `remote` needs no change there.

## Tests

`services/gcsp-api/src/test/java/gcsp/api/ordering/OrderingProviderBindingsTest.java`: 8 plain-JUnit methods, with no Quarkus boot, no database and no `@Alternative`. Stage 2 changed only the last method, whose old final check (that `OrderingSelection` refuses `remote`) is now false.

| Method | What it checks |
|---|---|
| `blankOrNoneDelegatesToTheUnconfiguredProviderAndOwnsNoClient` | Blank or `none` gives `UnconfiguredOrderingProvider` and no client |
| `syntheticDelegatesToTheUnchangedSelectionWithTheCallersDataSource` | `SyntheticOrderingProvider`; binding opens no connection; reconcile uses the passed datasource (a counting proxy that refuses connections), giving UNKNOWN `ordering-store-unavailable` |
| `remoteCapturesOneValidatedHttpAdapterWithoutAnyNetworkCall` | One `HttpOrderingProvider`, the same instance each call; the client never follows redirects and has the configured connect timeout; a loopback stub receives 0 requests |
| `remoteWithMissingSettingsFailsClosedAndNamesOnlyTheKeys` | Missing URLs, or no timeout, fail with the exact key-only message |
| `remoteWithInvalidSettingsFailsClosedWithoutEchoingEndpointsOrToken` | Non-loopback http, a query, a token with a space and 61s all fail, and the message contains neither the host nor the token; loopback http outside TEST and a zero timeout fail |
| `anUnknownOrDifferentlyCasedModeStopsStartup` | `live`, `Remote`, `Synthetic`, `bmw` are refused with the exact message |
| `closingShutsDownTheOwnedClientAndThenRefusesToHandOutAPort` | `close` terminates the client, is idempotent, and later `provider` calls refuse |
| `theConfiguredInstanceLifecycleFollowsTheCurrentSelection` | A configured instance refuses before `init`, then follows `synthetic` and unset. Stage 2: `OrderingSelection` accepts ` remote `; without URLs `init` fails closed naming `gcsp.ordering.execute-url` and hands nothing out; with https URLs it binds one `HttpOrderingProvider`, the same whatever datasource is passed, refused after `close` |

`services/gcsp-api/src/test/java/gcsp/api/ordering/RemoteOrderingStartupTest.java` (new in stage 2) has one started `@QuarkusTest` with one profile, `RemoteProfile`, and one test resource, `OrderingStub`.

- **Profile.** It sets `gcsp.ordering.provider=remote`, a test token and a 2s timeout. Datasource, Flyway and dev services are explicitly inactive. There is no `@Alternative`, and the selector and provider are not faked.
- **`OrderingStub`.** A `QuarkusTestResourceLifecycleManager` that owns a 127.0.0.1 JDK `HttpServer`. It supplies the loopback execute and reconcile URLs before Quarkus starts, and stops in `stop()` or when its own start fails.
- **The method, `remoteIsBoundAtStartupWithoutARequestAndReconcilesThroughTheSelectedPort`:**
  - The stub has received no ordering request after startup.
  - The injected `OrderingSelection.provider()`, `OrderingServiceHolder.provider()` and `OrderingProviderBindings.mode()` are all `remote`.
  - `bindings.provider(null)` is one cached `HttpOrderingProvider`.
  - `holder.service()` is empty without persistence. It is **not** a `Holder.service` execution.
  - One `reconcile` through the selected port gets the stub's echoed `not-found`, sent as one GET with the configured bearer token and no execute.

This is startup-boundary evidence only. It has no database, no JWT and no claim-to-order or order-status journey.

### Proposed finite run, parent-owned

Two chunks, with no PostgreSQL and no network beyond owned loopback stubs. Both need the module's JDK 21 tooling, not host `javac` 11.

1. `-Dtest=OrderingProviderBindingsTest` plus `OrderingSelectionTest`: plain JUnit, 10 methods.
2. `-Dtest=RemoteOrderingStartupTest`: one Quarkus boot, 1 method.

Expect seconds to well under a minute, and well under 256 MiB of scratch. The only owned resources are the in-process `HttpServer`s and clients, all stopped in `finally`, `close` or the resource's `stop`.

**Least-certain assertion.** In `RemoteOrderingStartupTest`, "no ordering request at startup" is read from the stub's own `/stats` counter, and the token check depends on the adapter sending `Authorization: Bearer <token>` on reconcile. Both follow from the source but have not been executed.

## Still open

- **Both original acceptance criteria stay open.** Remote ordering is now selectable at startup (stage 2, unrun). No connected claim, signed-in decision and order/status journey through the remote substitute has been shown.
- The full journey still needs the account policy binding: `AccountSelection` supplies the refusing policy port, which the Russell F458 lead owns. The hosted dev environment is absent, per Gary.
- The F477 M1 / FUCQ-515 hold continues, and Bugs 513-516 remain capture-only.
