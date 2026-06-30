import * as path from "path";
import * as vscode from "vscode";
import { NpmllServices } from "../services/container";
import { installPackage } from "../services/packageOperations";
import { logger } from "../utils/logger";
import { pickProjects, pickVersion } from "./pickers";
import { runOutdatedCheck } from "./checkCommands";

function projectsUsing(services: NpmllServices, packageId: string) {
  return (services.scanner.getModel()?.projects ?? []).filter((p) =>
    p.packages.some((pkg) => pkg.id.toLowerCase() === packageId.toLowerCase() && !pkg.isTransitive)
  );
}

export function registerUpdatePackageCommands(services: NpmllServices): vscode.Disposable[] {
  const updateOne = vscode.commands.registerCommand("npmll.updatePackage", async () => {
    const installed = new Set<string>();
    for (const project of services.scanner.getModel()?.projects ?? []) {
      for (const pkg of project.packages) {
        if (!pkg.isTransitive) {
          installed.add(pkg.id);
        }
      }
    }
    const packageId = await vscode.window.showQuickPick([...installed].sort(), { title: "Update Package" });
    if (!packageId) {
      return;
    }

    const using = projectsUsing(services, packageId);
    if (using.length === 0) {
      vscode.window.showInformationMessage(`npm LL: ${packageId} is not declared by any package.`);
      return;
    }
    const projects = await pickProjects(services, {
      title: `Update ${packageId} in...`,
      projects: using,
      preselect: using.map((p) => p.path)
    });
    if (!projects) {
      return;
    }
    const projectPaths = projects.map((p) => p.path);

    const currentVersion = using[0].packages.find(
      (pkg) => pkg.id.toLowerCase() === packageId.toLowerCase()
    )?.resolvedVersion;
    const version = await pickVersion(services, packageId, { currentVersion });
    if (version === undefined) {
      return;
    }
    await installPackage(services, packageId, projectPaths, version || undefined, { isUpdate: true });
  });

  const updateAll = vscode.commands.registerCommand("npmll.updateAllPackages", async () => {
    let outdated = services.results.outdated;
    if (!outdated) {
      outdated = await runOutdatedCheck(services);
    }
    if (!outdated || outdated.length === 0) {
      vscode.window.showInformationMessage("npm LL: all packages are up to date.");
      return;
    }
    const topLevel = outdated.filter((p) => !p.isTransitive);
    const summary = topLevel
      .map((p) => `  • ${p.projectName}: ${p.id} ${p.resolvedVersion} → ${p.latestVersion}`)
      .join("\n");
    const choice = await vscode.window.showWarningMessage(
      `Update ${topLevel.length} package(s) to their latest versions?`,
      { modal: true, detail: summary },
      "Update All"
    );
    if (choice !== "Update All") {
      return;
    }

    let failures = 0;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "npm LL: Updating packages", cancellable: true },
      async (progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        const model = services.scanner.getModel();
        for (const entry of topLevel) {
          if (token.isCancellationRequested) {
            break;
          }
          progress.report({ message: `${entry.id} → ${entry.latestVersion} (${entry.projectName})` });
          const project = model?.projects.find((p) => p.path === entry.projectPath);
          try {
            const result = await services.cli.install(
              path.dirname(entry.projectPath),
              entry.id,
              {
                version: entry.latestVersion,
                dependencyType:
                  project?.packages.find((p) => p.id === entry.id)?.dependencyType ?? entry.dependencyType
              },
              { signal: abort.signal }
            );
            if (result.cancelled) {
              break;
            }
            if (result.code !== 0) {
              failures++;
            }
          } catch (err) {
            failures++;
            logger.error(`Update failed for ${entry.id} in ${entry.projectName}`, err);
          }
        }
      }
    );

    if (failures === 0) {
      vscode.window.showInformationMessage("npm LL: all updates applied.");
    } else {
      vscode.window.showErrorMessage(`npm LL: ${failures} update(s) failed. See output for details.`);
    }
    await services.scanner.scan();
    await runOutdatedCheck(services);
  });

  return [updateOne, updateAll];
}
