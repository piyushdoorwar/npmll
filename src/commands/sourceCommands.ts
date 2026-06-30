import * as vscode from "vscode";
import { NpmllServices } from "../services/container";
import { DashboardPanel } from "../webview/dashboardPanel";

/**
 * npm registries are configured through .npmrc, which npm LL reads but never
 * writes (auth tokens are never persisted). These commands surface the
 * configured registries and let the user edit .npmrc directly.
 */
export function registerSourceCommands(services: NpmllServices): vscode.Disposable[] {
  const manage = vscode.commands.registerCommand("npmll.manageSources", () => {
    DashboardPanel.createOrShow(services, { tab: "sources" });
  });

  const openNpmrc = vscode.commands.registerCommand("npmll.openNpmrc", async () => {
    const configs = services.scanner.getModel()?.npmrcPaths ?? [];
    if (configs.length === 0) {
      vscode.window.showInformationMessage("npm LL: no .npmrc found in this workspace.");
      return;
    }
    const target =
      configs.length === 1 ? configs[0] : await vscode.window.showQuickPick(configs, { title: "Open .npmrc" });
    if (!target) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc);
  });

  return [manage, openNpmrc];
}
