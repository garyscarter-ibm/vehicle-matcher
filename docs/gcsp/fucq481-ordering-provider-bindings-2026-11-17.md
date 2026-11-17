# FUCQ-481 ordering provider bindings: 17 November 2026

This note covers one new startup component, `OrderingProviderBindings`, and its plain-JUnit tests. It was authored from `00f600dcd`, whose API tree matches integration `461049f73`. **Nothing here has been compiled or run.** It changes no screen, no existing source and no configuration.

It is the composition bridge planned in readiness 24 and MSG-2026-11-17-GC-001. It is a partial implementation of that binding. **It does not enable remote application startup:**

- the current `OrderingSelection.validate` still refuses `remote`;
- `OrderingServiceHolder` still calls `OrderingProviderSelection.select` and does not use this component.

Both files are foreign (F468) and were left read-only. MSG-2026-11-17-GC-001 is still unanswered; it does not block these new files.

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

These are the readiness 24 keys. They are not yet in `application.properties`, which is foreign and read-only here.

| Key | Type | Default |
|---|---|---|
| `gcsp.ordering.provider` | `none`, `synthetic`, `remote` | `none`, read by `OrderingSelection` |
| `gcsp.ordering.execute-url` | `Optional<String>`, https (loopback http in TEST only) | unset |
| `gcsp.ordering.reconcile-url` | `Optional<String>`, as above, no query | unset |
| `gcsp.ordering.token` | `Optional<String>`, visible ASCII | unset |
| `gcsp.ordering.timeout` | `Duration`, above 0 and at most 60s | `10s` |

With `none` or `synthetic` the URL keys are not read for validation, so the component boots harmlessly under every existing profile.

## The remaining handoff, outside this allocation

Three small edits to foreign files would connect it:

1. **`OrderingSelection.validate`** accepts `remote` as well as `none` and `synthetic`.
2. **`OrderingServiceHolder`** adds `@Inject OrderingProviderBindings bindings;` and replaces the provider argument at line 48:
   `OrderingProviderSelection.select(selection.provider(), ds)` becomes `bindings.provider(ds)`.
3. **`application.properties`** adds the four keys above, with `${GCSP_ORDERING_*:}` environment fallbacks and the default left at `none`.

`OrderingResource`, `OrderingStartup` and `SelectionOrderTickHandler` compare `holder.provider()` with `none` only, so `remote` needs no change there.

## Tests

`services/gcsp-api/src/test/java/gcsp/api/ordering/OrderingProviderBindingsTest.java`: 8 plain-JUnit methods, with no Quarkus boot, no database and no `@Alternative`.

| Method | What it checks |
|---|---|
| `blankOrNoneDelegatesToTheUnconfiguredProviderAndOwnsNoClient` | Blank or `none` gives `UnconfiguredOrderingProvider` and no client |
| `syntheticDelegatesToTheUnchangedSelectionWithTheCallersDataSource` | `SyntheticOrderingProvider`; binding opens no connection; reconcile uses the passed datasource (a counting proxy that refuses connections), giving UNKNOWN `ordering-store-unavailable` |
| `remoteCapturesOneValidatedHttpAdapterWithoutAnyNetworkCall` | One `HttpOrderingProvider`, the same instance each call; the client never follows redirects and has the configured connect timeout; a loopback stub receives 0 requests |
| `remoteWithMissingSettingsFailsClosedAndNamesOnlyTheKeys` | Missing URLs, or no timeout, fail with the exact key-only message |
| `remoteWithInvalidSettingsFailsClosedWithoutEchoingEndpointsOrToken` | Non-loopback http, a query, a token with a space and 61s all fail, and the message contains neither the host nor the token; loopback http outside TEST and a zero timeout fail |
| `anUnknownOrDifferentlyCasedModeStopsStartup` | `live`, `Remote`, `Synthetic`, `bmw` are refused with the exact message |
| `closingShutsDownTheOwnedClientAndThenRefusesToHandOutAPort` | `close` terminates the client, is idempotent, and later `provider` calls refuse |
| `theConfiguredInstanceLifecycleFollowsTheCurrentSelection` | A configured instance refuses before `init`, then follows `synthetic` and unset; current `OrderingSelection` still refuses `remote` |

This is component validation only. It is not a remote boot profile and not a whole-journey proof.

### Proposed finite run, parent-owned

One plain-JUnit chunk, with no PostgreSQL and no network beyond one loopback stub: `-Dtest=OrderingProviderBindingsTest`, 8 methods. It needs the module's JDK 21 tooling, not host `javac` 11. Expect seconds of runtime and well under 256 MiB of scratch. The only owned resources are one in-process `HttpServer` and the clients, all stopped in `finally` or `close`.

## Still open

- **Both original acceptance criteria stay open.** Remote ordering is not selectable at startup until the three foreign edits above land.
- `AccountSelection` still supplies the refusing policy port (F458). The hosted dev environment is absent, per Gary.
- The F477 M1 / FUCQ-515 hold continues, and Bugs 513-516 remain capture-only.
