// Mirror of the extension-side models and message protocol
// (src/models/* and src/webview/messageProtocol.ts). Keep in sync.

export type DependencyType =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

export interface PackageReference {
  id: string;
  /** Declared semver range from package.json. */
  version?: string;
  /** Version installed in node_modules, when present. */
  resolvedVersion?: string;
  dependencyType: DependencyType;
  isInstalled: boolean;
  isTransitive?: boolean;
}

export interface ProjectInfo {
  name: string;
  path: string;
  version?: string;
  isWorkspaceRoot: boolean;
  hasNodeModules: boolean;
  packages: PackageReference[];
}

export interface PackageSource {
  name: string;
  url: string;
  enabled: boolean;
  scope?: string;
  configPath?: string;
  hasCredentials?: boolean;
}

export interface WorkspaceModel {
  folders: string[];
  roots: string[];
  projects: ProjectInfo[];
  npmrcPaths: string[];
  sources: PackageSource[];
  npmVersion?: string;
  nodeVersion?: string;
  scannedAt: number;
}

export interface PackageSearchResult {
  id: string;
  version: string;
  description?: string;
  iconUrl?: string;
  totalDownloads?: number;
  verified?: boolean;
  authors: string[];
  owners?: string[];
  tags: string[];
  projectUrl?: string;
  source: string;
}

export interface PackageVersionInfo {
  version: string;
  downloads?: number;
  isPrerelease: boolean;
}

export interface PackageDependencyGroup {
  name: string;
  dependencies: { id: string; range: string }[];
}

export interface PackageDetails extends PackageSearchResult {
  licenseExpression?: string;
  licenseUrl?: string;
  repositoryUrl?: string;
  latestStableVersion?: string;
  latestPrereleaseVersion?: string;
  versions: PackageVersionInfo[];
  deprecation?: {
    reasons: string[];
    message?: string;
    alternativePackageId?: string;
    alternativePackageRange?: string;
  };
  vulnerabilities?: { severity: string; advisoryUrl: string }[];
  dependencyGroups: PackageDependencyGroup[];
  usedInProjects: { name: string; path: string; version?: string }[];
}

export interface OutdatedPackage {
  id: string;
  projectName: string;
  projectPath: string;
  requestedVersion?: string;
  resolvedVersion: string;
  wantedVersion?: string;
  latestVersion: string;
  dependencyType?: DependencyType;
  isTransitive?: boolean;
}

export interface VulnerablePackage {
  id: string;
  projectName: string;
  projectPath: string;
  resolvedVersion: string;
  severity: string;
  advisoryUrl: string;
  title?: string;
  vulnerableRange?: string;
  isTransitive?: boolean;
}

export interface DeprecatedPackage {
  id: string;
  projectName: string;
  projectPath: string;
  resolvedVersion: string;
  reasons: string[];
  alternativeId?: string;
  alternativeVersionRange?: string;
}

export interface NpmllSettingsSnapshot {
  defaultRegistry: string;
  includePrerelease: boolean;
  showTransitivePackages: boolean;
  confirmBeforeMultiProjectChanges: boolean;
  saveExact: boolean;
  preferNpmCli: boolean;
  registryApiUrl: string;
  maxSearchResults: number;
  npmAvailable: boolean;
  npmVersion?: string;
  nodeVersion?: string;
}

export type WebviewToExtensionMessage =
  | { type: "scanWorkspace" }
  | {
      type: "searchPackages";
      query: string;
      includePrerelease: boolean;
      exactMatch?: boolean;
      source?: string;
      skip?: number;
      take?: number;
    }
  | { type: "getPackageDetails"; packageId: string; source?: string }
  | { type: "installPackage"; packageId: string; version?: string; projectPaths: string[]; dependencyType?: DependencyType }
  | { type: "updatePackage"; packageId: string; version: string; projectPaths: string[] }
  | { type: "removePackage"; packageId: string; projectPaths: string[] }
  | { type: "checkOutdated" }
  | { type: "checkVulnerable" }
  | { type: "checkDeprecated" }
  | { type: "listSources" }
  | { type: "openNpmrc" }
  | { type: "installDependencies"; projectPath?: string }
  | { type: "openExternal"; url: string }
  | { type: "openFile"; path: string }
  | { type: "openVsCodeSettings" }
  | { type: "getSettings" };

export type ExtensionToWebviewMessage =
  | { type: "workspaceModel"; model: WorkspaceModel }
  | { type: "searchResults"; query: string; results: PackageSearchResult[] }
  | { type: "packageDetails"; details: PackageDetails }
  | { type: "operationStarted"; operationId: string; label: string }
  | { type: "operationProgress"; operationId: string; message: string }
  | { type: "operationCompleted"; operationId: string; message: string }
  | { type: "operationFailed"; operationId: string; error: string }
  | { type: "packageUpdated"; packageId: string; projectPaths: string[]; success: boolean }
  | { type: "sourcesUpdated"; sources: PackageSource[] }
  | { type: "settingsUpdated"; settings: NpmllSettingsSnapshot }
  | { type: "navigate"; tab: string; query?: string }
  | { type: "outdatedResults"; results: OutdatedPackage[]; errors: string[]; done: boolean; progress?: CheckProgressInfo }
  | { type: "vulnerableResults"; results: VulnerablePackage[]; errors: string[]; done: boolean; progress?: CheckProgressInfo }
  | { type: "deprecatedResults"; results: DeprecatedPackage[]; errors: string[]; done: boolean; progress?: CheckProgressInfo };

/** Progress of a streaming check, in units of analyzed targets (workspace packages). */
export interface CheckProgressInfo {
  completed: number;
  total: number;
}

export type TabId =
  | "overview"
  | "browse"
  | "installed"
  | "updates"
  | "vulnerabilities"
  | "sources"
  | "settings";
