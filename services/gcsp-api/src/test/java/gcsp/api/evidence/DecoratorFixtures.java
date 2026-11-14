package gcsp.api.evidence;

import java.nio.file.Path;

/** Builds the production decorator stack over a retained store, as Node createLocalVehicleEvidenceLookup does. */
final class DecoratorFixtures {

    static final Path REPO = EvidenceFixtures.MODULE.resolve("../..").normalize();
    static final Path CATALOGUE = EvidenceFixtures.REAL.resolve("display-images.v1.json");
    static final Path SEED = EvidenceFixtures.REAL.resolve("configuration-definitions.v1.json");

    private DecoratorFixtures() {}

    static DisplayCatalogue catalogue() {
        return new DisplayCatalogue(CATALOGUE, REPO);
    }

    static VehicleEvidenceLookup lookup(String store, DisplayCatalogue catalogue, ConfigurationDefinitions definitions) {
        EvidenceRegistry registry = EvidenceRegistry.of(LookupCases.store(store));
        return new VehicleEvidenceLookup(stack(registry, catalogue, definitions), null);
    }

    static EvidenceRegistry stack(EvidenceRegistry base, DisplayCatalogue catalogue, ConfigurationDefinitions definitions) {
        EvidenceRegistry images = catalogue == null ? base : new DisplayImageRegistry(base, catalogue);
        return definitions == null ? images : new DefinitionRegistry(images, definitions);
    }
}
