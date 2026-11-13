export interface RuntimePublicConfig {
  readonly schemaVersion: 1;
  readonly environmentId: string;
  readonly apiBaseUrl: string;
  readonly oidc: {
    readonly authority: string; readonly clientId: string; readonly scope: string;
    readonly redirectUri: string; readonly postLogoutRedirectUri: string;
  };
}
export const RUNTIME_CONFIG_PATH = '/gcsp/runtime-config.json';
