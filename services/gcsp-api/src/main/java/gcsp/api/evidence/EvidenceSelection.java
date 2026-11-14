package gcsp.api.evidence;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Chooses the vehicle evidence provider once at startup; no silent fallback, an unusable setting stops the service. */
@ApplicationScoped
@Startup
public class EvidenceSelection {

    public static final String NONE = "none";
    public static final String LOOKUP = "lookup";
    public static final String ALTERNATE_OFFLINE = "alternate-offline";
    private static final Logger LOG = Logger.getLogger(EvidenceSelection.class);

    /** What startup built; load, catalogue and definitions are null for provider none. */
    public record Selected(String provider, VehicleDetailsConsumer consumer, LoadOutcome load, DisplayCatalogue catalogue,
            ConfigurationDefinitions definitions, long loadMillis) {}

    @ConfigProperty(name = "gcsp.evidence.provider", defaultValue = NONE)
    String providerName;

    @ConfigProperty(name = "gcsp.evidence.store")
    Optional<String> store;

    @ConfigProperty(name = "gcsp.evidence.reference-dir")
    Optional<String> referenceDir;

    @ConfigProperty(name = "gcsp.evidence.assets-root")
    Optional<String> assetsRoot;

    @ConfigProperty(name = "gcsp.evidence.alternate-file")
    Optional<String> alternateFile;

    @ConfigProperty(name = "gcsp.evidence.images-public", defaultValue = "false")
    boolean imagesPublic;

    @ConfigProperty(name = "gcsp.evidence.timeout-ms", defaultValue = "1000")
    int timeoutMs;

    @ConfigProperty(name = "gcsp.evidence.max-attempts", defaultValue = "1")
    int maxAttempts;

    @Inject
    Instance<StockPort> stockPort;

    private volatile Selected selected;

    @PostConstruct
    void init() {
        StockPort stock = stockPort.isResolvable() ? stockPort.get() : null;
        selected = select(providerName, store.orElse(null), referenceDir.orElse(null), assetsRoot.orElse(null),
                alternateFile.orElse(null), timeoutMs, maxAttempts, stock);
        LOG.info(describe(selected));
    }

    public Selected selected() {
        return selected;
    }

    public boolean imagesPublic() {
        return imagesPublic;
    }

    /** Pure selection rule, static so every refusal is unit-testable without a server. */
    public static Selected select(String provider, String store, String referenceDir, String assetsRoot,
            String alternateFile, int timeoutMs, int maxAttempts, StockPort stock) {
        String name = provider == null || provider.isBlank() ? NONE : provider.trim();
        if (NONE.equals(name)) return new Selected(NONE, new VehicleDetailsConsumer(null), null, null, null, 0);
        if (!LOOKUP.equals(name) && !ALTERNATE_OFFLINE.equals(name)) {
            throw new IllegalStateException("Unknown gcsp.evidence.provider '" + name + "'; supported: " + NONE + ", "
                    + LOOKUP + ", " + ALTERNATE_OFFLINE);
        }
        Path storeRoot = required("gcsp.evidence.store", store, name, true);
        Path reference = required("gcsp.evidence.reference-dir", referenceDir, name, true);
        Path assets = required("gcsp.evidence.assets-root", assetsRoot, name, true);
        Path offline = ALTERNATE_OFFLINE.equals(name) ? required("gcsp.evidence.alternate-file", alternateFile, name, false) : null;
        long start = System.nanoTime();
        CorpusStore corpus = new CorpusStore(storeRoot);
        LoadOutcome load = corpus.load();
        DisplayCatalogue catalogue = new DisplayCatalogue(reference.resolve("display-images.v1.json"), assets);
        ConfigurationDefinitions definitions = new ConfigurationDefinitions(reference.resolve("configuration-definitions.v1.json"));
        EvidenceRegistry registry = new DefinitionRegistry(new DisplayImageRegistry(EvidenceRegistry.of(corpus), catalogue), definitions);
        VehicleRouting routing = new VehicleRouting(corpus, stock, name);
        VehicleDetailsConsumer consumer;
        try {
            consumer = VehicleDetailsConsumer.configured(name, new VehicleEvidenceLookup(registry, stock),
                    offline == null ? null : new OfflineCardFile(offline), routing, timeoutMs, maxAttempts);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("gcsp.evidence.timeout-ms must be 1..5000 and gcsp.evidence.max-attempts 1..2");
        }
        return new Selected(name, consumer, load, catalogue, definitions, (System.nanoTime() - start) / 1_000_000);
    }

    private static Path required(String key, String value, String provider, boolean directory) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("gcsp.evidence.provider=" + provider + " needs " + key);
        }
        Path path = Path.of(value.trim());
        if (!path.isAbsolute()) throw new IllegalStateException(key + " must be an absolute path");
        boolean exists = directory ? Files.isDirectory(path) : Files.isRegularFile(path) && Files.isReadable(path);
        if (!exists) throw new IllegalStateException(key + " is set but is not an existing " + (directory ? "directory" : "file"));
        return path;
    }

    static String describe(Selected s) {
        if (s.load() == null) return "GCSP vehicle evidence provider: none (every read is source-unavailable)";
        ActiveInfo active = s.load().active();
        if (active == null) {
            return "GCSP vehicle evidence provider: " + s.provider() + ", corpus unavailable ("
                    + (s.load().failure() == null ? "corpus-absent" : s.load().failure().code()) + ")";
        }
        return "GCSP vehicle evidence provider: " + s.provider() + ", dataset " + active.datasetId() + " version "
                + active.version() + " manifestDigest " + active.manifestDigest() + ", recovered " + s.load().recovered()
                + ", loaded in " + s.loadMillis() + " ms";
    }
}
