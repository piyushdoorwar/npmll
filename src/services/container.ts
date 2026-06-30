import * as vscode from "vscode";
import { DeprecatedPackage, OutdatedPackage, VulnerablePackage } from "../models/packageModel";
import { NpmApiService } from "./npmApiService";
import { NpmCliService } from "./npmCliService";
import { PackageSourceService } from "./packageSourceService";
import { VulnerabilityService } from "./vulnerabilityService";
import { WorkspaceScanner } from "./workspaceScanner";

/** Holds the latest outdated/vulnerable/deprecated reports for views and webview. */
export class ResultsStore {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  outdated: OutdatedPackage[] | undefined;
  vulnerable: VulnerablePackage[] | undefined;
  deprecated: DeprecatedPackage[] | undefined;

  setOutdated(results: OutdatedPackage[]): void {
    this.outdated = results;
    this.emitter.fire();
  }

  setVulnerable(results: VulnerablePackage[]): void {
    this.vulnerable = results;
    this.emitter.fire();
  }

  setDeprecated(results: DeprecatedPackage[]): void {
    this.deprecated = results;
    this.emitter.fire();
  }

  clear(): void {
    this.outdated = undefined;
    this.vulnerable = undefined;
    this.deprecated = undefined;
    this.emitter.fire();
  }
}

export interface NpmState {
  available: boolean;
  version?: string;
  nodeVersion?: string;
}

/** Dependency container shared by commands, views and the webview panel. */
export interface NpmllServices {
  context: vscode.ExtensionContext;
  scanner: WorkspaceScanner;
  cli: NpmCliService;
  api: NpmApiService;
  sources: PackageSourceService;
  vulnerabilities: VulnerabilityService;
  results: ResultsStore;
  npm: NpmState;
}
