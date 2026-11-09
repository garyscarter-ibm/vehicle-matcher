import { fileURLToPath } from 'node:url';

// The reviewed model artifacts shipped with the repository; the policy reference only picks one by digest.
export const TRUSTED_ARTIFACT_DIRECTORY = fileURLToPath(new URL('../../../../docs/gcsp/models/artifacts/', import.meta.url));
