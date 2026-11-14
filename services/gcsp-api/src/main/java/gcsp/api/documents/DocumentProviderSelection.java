package gcsp.api.documents;

/** Chooses the document provider named by configuration; a static selector until a CDI producer exists. */
public final class DocumentProviderSelection {

    private DocumentProviderSelection() {}

    public static DocumentProviderPort select(String name) {
        if (name == null || name.isBlank() || "none".equals(name)) return new UnconfiguredDocumentProvider();
        return switch (name) {
            case "synthetic" -> new SyntheticDocumentProvider();
            case "unsupported" -> new UnsupportedDocumentProvider();
            default -> throw new IllegalStateException("Unknown gcsp.documents.provider '" + name
                    + "'; supported: none, synthetic, unsupported");
        };
    }
}
