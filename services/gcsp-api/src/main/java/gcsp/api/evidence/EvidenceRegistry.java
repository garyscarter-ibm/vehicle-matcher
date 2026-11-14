package gcsp.api.evidence;

/** Read-only evidence source behind the lookup; decorators wrap it like Node's registry decorators. */
public interface EvidenceRegistry {

    EvidenceSource getConfiguration(String id);

    EvidenceSource getVin(String id);

    static EvidenceRegistry of(CorpusStore store) {
        return new EvidenceRegistry() {
            @Override
            public EvidenceSource getConfiguration(String id) {
                return EvidenceSource.from(store.getConfiguration(id));
            }

            @Override
            public EvidenceSource getVin(String id) {
                return EvidenceSource.from(store.getVin(id));
            }
        };
    }
}
