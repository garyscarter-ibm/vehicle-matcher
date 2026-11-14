package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/** Node withDisplayImages: replaces the images only when the retained gallery is non-empty. */
public final class DisplayImageRegistry implements EvidenceRegistry {

    private final EvidenceRegistry inner;
    private final DisplayCatalogue catalogue;

    public DisplayImageRegistry(EvidenceRegistry inner, DisplayCatalogue catalogue) {
        this.inner = inner;
        this.catalogue = catalogue;
    }

    @Override
    public EvidenceSource getConfiguration(String id) {
        return enrich(inner.getConfiguration(id));
    }

    @Override
    public EvidenceSource getVin(String id) {
        return enrich(inner.getVin(id));
    }

    private EvidenceSource enrich(EvidenceSource source) {
        if (source == null || !("ok".equals(source.status()) || "complete".equals(source.status())
                || "partial".equals(source.status()))) return source;
        List<JsonNode> images = catalogue.gallery(source.record());
        if (images.isEmpty()) return source;
        return new EvidenceSource(source.status(), source.active(), source.record(), source.vehicle(),
                source.technicalSupplement(), images, source.definitionResolution());
    }
}
