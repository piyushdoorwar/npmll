import * as vscode from "vscode";
import { registerAddPackageCommand } from "./commands/addPackageCommand";
import { registerCheckCommands } from "./commands/checkCommands";
import { registerDashboardCommands } from "./commands/dashboardCommand";
import { registerInstallCommands } from "./commands/restoreCommand";
import { registerRemovePackageCommand } from "./commands/removePackageCommand";
import { registerSourceCommands } from "./commands/sourceCommands";
import { registerUpdatePackageCommands } from "./commands/updatePackageCommand";
import { getConfig } from "./config";
import { NpmApiService } from "./services/npmApiService";
import { NpmCliService } from "./services/npmCliService";
import { NpmllServices, ResultsStore } from "./services/container";
import { PackageSourceService } from "./services/packageSourceService";
import { VulnerabilityService } from "./services/vulnerabilityService";
import { WorkspaceScanner } from "./services/workspaceScanner";
import { debounce } from "./utils/debounce";
import { logger } from "./utils/logger";
import { DashboardPanel } from "./webview/dashboardPanel";
import { HomeViewProvider } from "./webview/homeViewProvider";

const WATCH_PATTERNS = ["**/package.json", "**/.npmrc"];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info("npm LL activating...");

  const scanner = new WorkspaceScanner(
    () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    () => getConfig().excludedFolders
  );
  const cli = new NpmCliService((line) => logger.output(line));
  const sources = new PackageSourceService(scanner);
  const api = new NpmApiService(() => getConfig().registryApiUrl);
  const services: NpmllServices = {
    context,
    scanner,
    cli,
    api,
    sources,
    vulnerabilities: new VulnerabilityService(cli, api),
    results: new ResultsStore(),
    npm: { available: false }
  };

  // All UI lives in webviews: the activity bar hosts a small launcher view
  // and the dashboard panel carries the full experience.
  const homeProvider = new HomeViewProvider(services);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HomeViewProvider.viewId, homeProvider)
  );

  // Commands
  context.subscriptions.push(
    registerAddPackageCommand(services),
    registerRemovePackageCommand(services),
    ...registerUpdatePackageCommands(services),
    ...registerCheckCommands(services),
    ...registerInstallCommands(services),
    ...registerSourceCommands(services),
    ...registerDashboardCommands(services)
  );

  // File watchers with a 500ms debounced refresh. node_modules churn is ignored
  // so an install doesn't trigger a rescan storm.
  const refresh = debounce(() => {
    if (getConfig().autoRefreshOnManifestChange) {
      scanner.scan().then(() => homeProvider.push()).catch((err) => logger.error("Workspace scan failed", err));
      DashboardPanel.pushSources(services);
    }
  }, 500);
  const onChange = (uri: vscode.Uri) => {
    if (!uri.fsPath.split(/[\\/]/).includes("node_modules")) {
      refresh();
    }
  };
  for (const pattern of WATCH_PATTERNS) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    watcher.onDidDelete(onChange);
    context.subscriptions.push(watcher);
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
    services.results.onDidChange(() => homeProvider.push()),
    { dispose: () => refresh.cancel() },
    { dispose: () => logger.dispose() }
  );

  // npm/node detection (non-blocking).
  void cli.detectNpm().then(async (npm) => {
    services.npm.available = npm.available;
    services.npm.version = npm.version;
    services.npm.nodeVersion = await cli.detectNode();
    vscode.commands.executeCommand("setContext", "npmll.npmAvailable", npm.available);
    if (npm.available) {
      logger.info(`npm detected: ${npm.version ?? "unknown version"} (node ${services.npm.nodeVersion ?? "unknown"})`);
    } else {
      logger.warn("npm was not found on PATH. Package actions are disabled.");
      vscode.window
        .showErrorMessage(
          "npm LL: npm was not found. Install Node.js to enable package management.",
          "Open Node.js downloads"
        )
        .then((choice) => {
          if (choice === "Open Node.js downloads") {
            vscode.env.openExternal(vscode.Uri.parse("https://nodejs.org/en/download"));
          }
        });
    }
    homeProvider.push();
  });

  // Initial scan.
  if (getConfig().scanOnStartup) {
    scanner
      .scan()
      .then((result) => {
        logger.info(
          `Workspace scan complete: ${result.model.projects.length} package(s), ${result.model.roots.length} workspace root(s).`
        );
        for (const issue of result.issues) {
          logger.warn(`${issue.file}: ${issue.message}`);
        }
        homeProvider.push();
      })
      .catch((err) => logger.error("Initial workspace scan failed", err));
  }
}

export function deactivate(): void {
  // Disposables are handled via context.subscriptions.
}
