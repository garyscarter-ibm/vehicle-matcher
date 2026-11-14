package gcsp.api.learning;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reads artifacts from a store and keeps each verified one with the stat it was verified at, so a forecast costs a
 * stat rather than a parse and digest. A changed size or timestamp is re-read and re-verified, failing as Node does.
 */
public final class ModelArtifacts {

    private record Verified(ArtifactStore.Stat stat, ModelArtifact artifact) {}

    private final ArtifactStore store;
    private final Map<String, Verified> verified = new ConcurrentHashMap<>();

    public ModelArtifacts(ArtifactStore store) {
        this.store = store;
    }

    private static String fileName(String artifactId) {
        return artifactId.substring(7) + ".json";
    }

    /** True when the named file exists in the store (the provider's artifact-missing test). */
    public boolean exists(String artifactId) {
        return ModelArtifact.validId(artifactId) && store.stat(fileName(artifactId)) != null;
    }

    /** readModelArtifact: verified and pinned to the id, or a ChoiceModelException with Node's code. */
    public ModelArtifact read(String artifactId) {
        ChoiceModelException.require(ModelArtifact.validId(artifactId), "artifact.path");
        String name = fileName(artifactId);
        ArtifactStore.Stat stat = store.stat(name);
        if (stat == null) {
            verified.remove(artifactId);
            throw new ChoiceModelException(ChoiceModelException.UNAVAILABLE, "artifact");
        }
        Verified known = verified.get(artifactId);
        if (known != null && known.stat().equals(stat)) return known.artifact();
        verified.remove(artifactId);
        ChoiceModelException.require(stat.size() <= ModelArtifact.MAX_BYTES, "artifact.size");
        byte[] bytes;
        try {
            bytes = store.read(name, ModelArtifact.MAX_BYTES);
        } catch (IOException | RuntimeException e) {
            throw new ChoiceModelException(ChoiceModelException.UNAVAILABLE, "artifact");
        }
        ModelArtifact artifact = ModelArtifact.parse(bytes, artifactId);
        verified.put(artifactId, new Verified(stat, artifact));
        return artifact;
    }
}
