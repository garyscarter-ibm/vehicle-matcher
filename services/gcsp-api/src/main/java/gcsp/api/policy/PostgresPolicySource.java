package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads a run's retained policy versions from PostgreSQL: one indexed header query per read, and the documents only
 * when a header changed. A run's first read materializes its base version from the retained file.
 */
public final class PostgresPolicySource implements PolicySource {

    static final int CACHE_RUNS = 8;

    private record Entry(List<String> key, List<JsonNode> versions) {
    }

    private final PolicyDatabase db;
    private final RetainedFilePolicySource base;
    private final Map<String, Entry> cache = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Entry> eldest) {
            return size() > CACHE_RUNS;
        }
    };

    PostgresPolicySource(PolicyDatabase db, RetainedFilePolicySource base) {
        this.db = db;
        this.base = base;
    }

    @Override
    public List<JsonNode> loadVersions(String runId) throws PolicySourceException {
        if (runId == null || runId.isBlank()) {
            throw new PolicySourceException(PolicySourceException.INVALID);
        }
        try (Connection c = db.dataSource().getConnection()) {
            List<PolicyRecords.Header> headers = PolicyRecords.headers(c, db.environmentId(), runId);
            if (headers.isEmpty()) {
                materialize(c, runId);
                headers = PolicyRecords.headers(c, db.environmentId(), runId);
                if (headers.isEmpty()) {
                    throw new PolicySourceException(PolicySourceException.UNAVAILABLE);
                }
            }
            List<String> key = headers.stream().map(PolicyRecords.Header::key).toList();
            Entry cached = cached(runId, key);
            if (cached != null) {
                return cached.versions();
            }
            var documents = PolicyRecords.documents(c, headers.stream().map(PolicyRecords.Header::seedDigest).distinct().toList());
            List<JsonNode> versions = new ArrayList<>();
            for (PolicyRecords.Header header : headers) {
                versions.add(PolicyRecords.verified(header, documents.get(header.seedDigest())));
            }
            return remember(runId, new Entry(key, List.copyOf(versions))).versions();
        } catch (SQLException | RuntimeException e) {
            throw new PolicySourceException(PolicySourceException.UNAVAILABLE);
        }
    }

    /** Inserts the base seed once under the run lock (the publisher's order); an unknown run is unavailable. */
    private void materialize(Connection c, String runId) throws SQLException, PolicySourceException {
        ObjectNode seed = PolicyRecords.baseSeed(base, runId);
        boolean auto = c.getAutoCommit();
        try {
            c.setAutoCommit(false);
            if (!PolicyRecords.lockRun(c, db.environmentId(), runId)) {
                throw new PolicySourceException(PolicySourceException.UNAVAILABLE);
            }
            PolicyRecords.insertBase(PolicyRecords.on(c), db.environmentId(), runId, seed);
            c.commit();
        } catch (SQLException | PolicySourceException | RuntimeException e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(auto);
        }
    }

    private Entry cached(String runId, List<String> key) {
        synchronized (cache) {
            Entry entry = cache.get(runId);
            return entry != null && entry.key().equals(key) ? entry : null;
        }
    }

    private Entry remember(String runId, Entry loaded) {
        synchronized (cache) {
            Entry existing = cache.get(runId);
            if (existing != null && existing.key().equals(loaded.key())) {
                return existing;
            }
            cache.put(runId, loaded);
            return loaded;
        }
    }

    @Override
    public void invalidate(String runId) {
        synchronized (cache) {
            cache.remove(runId);
        }
    }
}
