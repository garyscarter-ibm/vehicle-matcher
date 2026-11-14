package gcsp.api.ordering;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Any;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;

/**
 * The converter for a source type: any SelectionConversionPort bean that names it (FUCQ-463 cart, FUCQ-464/466
 * buddy-offer), else the unconfigured one. A later Story binds by providing its bean; no code here changes.
 */
@ApplicationScoped
public class OrderingConversions {

    @Inject
    @Any
    Instance<SelectionConversionPort> beans;

    public SelectionConversionPort forSource(String sourceType) {
        for (SelectionConversionPort b : beans) {
            if (sourceType.equals(b.sourceType())) return b;
        }
        return new UnconfiguredConversion(sourceType);
    }
}
