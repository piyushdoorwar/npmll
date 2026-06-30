/** An npm registry configured via .npmrc (default or scoped). */
export interface PackageSource {
  /** Display name: "npm" for the default registry, or the scope (e.g. "@acme"). */
  name: string;
  /** Registry URL. */
  url: string;
  /** npm registries are always active; kept for UI parity with the source model. */
  enabled: boolean;
  /** Scope this registry maps to (e.g. "@acme"). Undefined for the default registry. */
  scope?: string;
  /** Path of the .npmrc that defines this registry, when known. */
  configPath?: string;
  /** Whether an auth token is configured for this registry (token value is never read). */
  hasCredentials?: boolean;
}
