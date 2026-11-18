package gcsp.api.learning;

import java.io.IOException;

/** Where model artifacts live: a directory or the classpath copy. Names are always <64 hex>.json. */
public interface ArtifactStore {

    /** What a cheap existence check sees; a changed value forces a re-verify. */
    record Stat(long size, long modifiedNanos) {}

    /** The file's stat, or null when no such file exists. */
    Stat stat(String fileName);

    /** The file's bytes, at most limit + 1 of them so an oversized file is detectable without reading it all. */
    byte[] read(String fileName, int limit) throws IOException;
}
