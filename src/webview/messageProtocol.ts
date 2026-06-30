import {
  DeprecatedPackage,
  OutdatedPackage,
  PackageDetails,
  PackageSearchResult,
  VulnerablePackage
} from "../models/packageModel";
import { PackageSource } from "../models/sourceModel";
import { WorkspaceModel } from "../models/workspaceModel";

/** Settings snapshot shared with the webview. */
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

// ---------------------------------------------------------------------------
// Webview -> Extension
// ---------------------------------------------------------------------------

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
  | {
      type: "installPackage";
      packageId: string;
      version?: string;
      projectPaths: string[];
      dependencyType?: string;
    }
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

// ---------------------------------------------------------------------------
// Extension -> Webview
// ---------------------------------------------------------------------------

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
