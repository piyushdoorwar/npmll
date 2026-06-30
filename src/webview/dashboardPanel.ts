import * as vscode from "vscode";
import { getConfig } from "../config";
import { DependencyType, PackageSearchResult } from "../models/packageModel";
import { NpmllServices } from "../services/container";
import { parseSearchJson } from "../services/npmCliService";
import { installDependencies, installPackage, removePackage } from "../services/packageOperations";
import { logger } from "../utils/logger";
import { isInsideAny } from "../utils/pathUtils";
import {
  ExtensionToWebviewMessage,
  NpmllSettingsSnapshot,
  WebviewToExtensionMessage
} from "./messageProtocol";
import { getWebviewHtml } from "./webviewHtml";

let operationCounter = 0;

export class DashboardPanel {
  static current: DashboardPanel | undefined;

  static createOrShow(services: NpmllServices, options: { tab?: string; query?: string } = {}): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal();
      if (options.tab) {
        DashboardPanel.current.post({ type: "navigate", tab: options.tab, query: options.query });
      }
      return;
    }
    const panel = vscode.window.createWebviewPanel("npmll.dashboard", "npm LL", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(services.context.extensionUri, "dist", "webview")]
    });
    DashboardPanel.current = new DashboardPanel(panel, services);
    if (options.tab) {
      // The webview requests state on load; queue the navigation slightly after.
      setTimeout(() => {
        DashboardPanel.current?.post({ type: "navigate", tab: options.tab as string, query: options.query });
      }, 600);
    }
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly services: NpmllServices) {
    panel.webview.html = getWebviewHtml(panel.webview, services.context.extensionUri);
    panel.iconPath = vscode.Uri.joinPath(services.context.extensionUri, "media", "npmll.svg");

    panel.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => {
        this.handleMessage(message).catch((err) => logger.error("Dashboard message failed", err));
      },
      undefined,
      this.disposables
    );

    const unsubscribe = services.scanner.onDidChangeModel((model) => {
      this.post({ type: "workspaceModel", model });
    });
    this.disposables.push({ dispose: unsubscribe });

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("npmll")) {
          this.post({ type: "settingsUpdated", settings: this.settingsSnapshot() });
        }
      })
    );

    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  post(message: ExtensionToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  /** Pushes a fresh registry list to the dashboard, if it is open. */
  static pushSources(services: NpmllServices): void {
    const panel = DashboardPanel.current;
    if (!panel) {
      return;
    }
    services.sources
      .listSources()
      .then((sources) => panel.post({ type: "sourcesUpdated", sources }))
      .catch((err) => logger.warn(`Refreshing registries for dashboard failed: ${String(err)}`));
  }

  private settingsSnapshot(): NpmllSettingsSnapshot {
    const config = getConfig();
    return {
      defaultRegistry: config.defaultRegistry,
      includePrerelease: config.includePrerelease,
      showTransitivePackages: config.showTransitivePackages,
      confirmBeforeMultiProjectChanges: config.confirmBeforeMultiProjectChanges,
      saveExact: config.saveExact,
      preferNpmCli: config.preferNpmCli,
      registryApiUrl: config.registryApiUrl,
      maxSearchResults: config.maxSearchResults,
      npmAvailable: this.services.npm.available,
      npmVersion: this.services.npm.version,
      nodeVersion: this.services.npm.nodeVersion
    };
  }

  /** Workspace packages to analyze. Per-package targets let checks stream one at a time. */
  private listTargets() {
    return this.services.scanner.getModel()?.projects ?? [];
  }

  private async runOperation(
    label: string,
    work: (report: (message: string) => void) => Promise<string>
  ): Promise<void> {
    const operationId = `op-${++operationCounter}`;
    this.post({ type: "operationStarted", operationId, label });
    const report = (message: string) => this.post({ type: "operationProgress", operationId, message });
    try {
      const message = await work(report);
      this.post({ type: "operationCompleted", operationId, message });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`${label} failed`, err);
      this.post({ type: "operationFailed", operationId, error: message });
    }
  }

  private async searchViaCli(query: string, take: number): Promise<PackageSearchResult[]> {
    const result = await this.services.cli.search(query, { take });
    if (result.code !== 0) {
      throw new Error((result.stderr || result.stdout || "npm search failed").trim().slice(0, 400));
    }
    return parseSearchJson(result.stdout) ?? [];
  }

  /** Resolves details for a package, routing scoped names to their scoped registry. */
  private async resolvePackageDetails(services: NpmllServices, packageId: string) {
    const sources = await services.sources.listSources().catch(() => []);
    if (packageId.startsWith("@")) {
      const scope = packageId.split("/")[0];
      const match = sources.find((s) => s.scope?.toLowerCase() === scope.toLowerCase());
      if (match) {
        try {
          return await services.api.getPackageDetails(packageId, {
            registryUrl: match.url,
            sourceName: match.name
          });
        } catch (err) {
          logger.warn(`Details for ${packageId} not found on '${match.name}': ${String(err)}`);
        }
      }
    }
    return services.api.getPackageDetails(packageId);
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    const services = this.services;
    switch (message.type) {
      case "scanWorkspace": {
        await services.scanner.scan();
        const model = services.scanner.getModel();
        if (model) {
          this.post({ type: "workspaceModel", model });
        }
        this.post({ type: "settingsUpdated", settings: this.settingsSnapshot() });
        break;
      }
      case "getSettings":
        this.post({ type: "settingsUpdated", settings: this.settingsSnapshot() });
        break;
      case "searchPackages": {
        const config = getConfig();
        const take = message.take ?? config.maxSearchResults;
        await this.runOperation(`Search "${message.query}"`, async () => {
          let results: PackageSearchResult[];
          if (config.preferNpmCli && services.npm.available) {
            results = await this.searchViaCli(message.query, take);
          } else {
            try {
              results = await services.api.searchPackages(message.query, { take, skip: message.skip });
            } catch (apiErr) {
              if (!services.npm.available) {
                throw apiErr;
              }
              logger.warn(`Registry search failed, falling back to npm CLI: ${String(apiErr)}`);
              results = await this.searchViaCli(message.query, take);
            }
          }
          if (message.exactMatch) {
            results = results.filter((r) => r.id.toLowerCase() === message.query.toLowerCase());
          }
          this.post({ type: "searchResults", query: message.query, results });
          return `${results.length} result(s)`;
        });
        break;
      }
      case "getPackageDetails":
        await this.runOperation(`Load details for ${message.packageId}`, async () => {
          const details = await this.resolvePackageDetails(services, message.packageId);
          const model = services.scanner.getModel();
          details.usedInProjects = (model?.projects ?? [])
            .filter((p) => p.packages.some((pkg) => pkg.id.toLowerCase() === message.packageId.toLowerCase()))
            .map((p) => ({
              name: p.name,
              path: p.path,
              version: p.packages.find((pkg) => pkg.id.toLowerCase() === message.packageId.toLowerCase())?.version
            }));
          this.post({ type: "packageDetails", details });
          return "details loaded";
        });
        break;
      case "installPackage":
        await this.runOperation(`Install ${message.packageId}`, async () => {
          const outcome = await installPackage(services, message.packageId, message.projectPaths, message.version, {
            skipConfirm: true,
            dependencyType: message.dependencyType as DependencyType | undefined
          });
          if (outcome.failed.length > 0) {
            throw new Error(outcome.failed.map((f) => `${f.project}: ${f.error}`).join("; "));
          }
          return `installed in ${outcome.succeeded.length} package(s)`;
        });
        break;
      case "updatePackage":
        await this.runOperation(`Update ${message.packageId}`, async () => {
          let success = false;
          try {
            const outcome = await installPackage(services, message.packageId, message.projectPaths, message.version, {
              isUpdate: true,
              skipConfirm: true
            });
            success = outcome.failed.length === 0 && outcome.succeeded.length > 0;
            if (outcome.failed.length > 0) {
              throw new Error(outcome.failed.map((f) => `${f.project}: ${f.error}`).join("; "));
            }
            return `updated in ${outcome.succeeded.length} package(s)`;
          } finally {
            // Let the Updates list prune the now-current rows (on success) or
            // clear their pending state (on failure) without a full re-check.
            this.post({
              type: "packageUpdated",
              packageId: message.packageId,
              projectPaths: message.projectPaths,
              success
            });
          }
        });
        break;
      case "removePackage":
        await this.runOperation(`Remove ${message.packageId}`, async () => {
          const outcome = await removePackage(services, message.packageId, message.projectPaths, {
            skipConfirm: true
          });
          if (outcome.failed.length > 0) {
            throw new Error(outcome.failed.map((f) => `${f.project}: ${f.error}`).join("; "));
          }
          return `removed from ${outcome.succeeded.length} package(s)`;
        });
        break;
      case "checkOutdated":
        await this.runOperation("Check outdated packages", async (report) => {
          const config = getConfig();
          const { results, errors } = await services.vulnerabilities.checkOutdated(
            this.listTargets(),
            { includeTransitive: config.showTransitivePackages },
            {},
            (partial) => {
              services.results.setOutdated(partial.results);
              report(`Reviewed ${partial.completed}/${partial.total} package(s)`);
              this.post({
                type: "outdatedResults",
                results: partial.results,
                errors: partial.errors,
                done: false,
                progress: { completed: partial.completed, total: partial.total }
              });
            }
          );
          services.results.setOutdated(results);
          this.post({ type: "outdatedResults", results, errors, done: true });
          return `${results.length} outdated package(s)`;
        });
        break;
      case "checkVulnerable":
        await this.runOperation("Check vulnerable packages", async (report) => {
          const { results, errors } = await services.vulnerabilities.checkVulnerable(
            this.listTargets(),
            { includeTransitive: true },
            {},
            (partial) => {
              services.results.setVulnerable(partial.results);
              report(`Reviewed ${partial.completed}/${partial.total} package(s)`);
              this.post({
                type: "vulnerableResults",
                results: partial.results,
                errors: partial.errors,
                done: false,
                progress: { completed: partial.completed, total: partial.total }
              });
            }
          );
          services.results.setVulnerable(results);
          this.post({ type: "vulnerableResults", results, errors, done: true });
          return `${results.length} vulnerable package(s)`;
        });
        break;
      case "checkDeprecated":
        await this.runOperation("Check deprecated packages", async (report) => {
          const { results, errors } = await services.vulnerabilities.checkDeprecated(
            this.listTargets(),
            {},
            {},
            (partial) => {
              services.results.setDeprecated(partial.results);
              report(`Reviewed ${partial.completed}/${partial.total} package(s)`);
              this.post({
                type: "deprecatedResults",
                results: partial.results,
                errors: partial.errors,
                done: false,
                progress: { completed: partial.completed, total: partial.total }
              });
            }
          );
          services.results.setDeprecated(results);
          this.post({ type: "deprecatedResults", results, errors, done: true });
          return `${results.length} deprecated package(s)`;
        });
        break;
      case "listSources":
        await this.runOperation("List registries", async () => {
          const sources = await services.sources.listSources();
          this.post({ type: "sourcesUpdated", sources });
          return `${sources.length} registr${sources.length === 1 ? "y" : "ies"}`;
        });
        break;
      case "openNpmrc": {
        const configs = services.scanner.getModel()?.npmrcPaths ?? [];
        if (configs.length === 0) {
          vscode.window.showInformationMessage("npm LL: no .npmrc found in this workspace.");
          break;
        }
        const doc = await vscode.workspace.openTextDocument(configs[0]);
        await vscode.window.showTextDocument(doc);
        break;
      }
      case "installDependencies":
        await installDependencies(services, message.projectPath || undefined);
        break;
      case "openExternal":
        if (/^https?:\/\//i.test(message.url)) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      case "openFile": {
        const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
        if (isInsideAny(roots, message.path)) {
          const doc = await vscode.workspace.openTextDocument(message.path);
          await vscode.window.showTextDocument(doc, { preview: true });
        }
        break;
      }
      case "openVsCodeSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "npmll");
        break;
    }
  }

  dispose(): void {
    DashboardPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.panel.dispose();
  }
}
