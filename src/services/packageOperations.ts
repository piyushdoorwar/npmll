import * as path from "path";
import * as vscode from "vscode";
import { getConfig } from "../config";
import { DependencyType } from "../models/packageModel";
import { ProjectInfo } from "../models/projectModel";
import { logger } from "../utils/logger";
import { isInsideAny } from "../utils/pathUtils";
import { NpmllServices } from "./container";

export interface OperationOutcome {
  succeeded: string[];
  failed: { project: string; error: string }[];
  skipped: { project: string; reason: string }[];
}

function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

function findProject(services: NpmllServices, projectPath: string): ProjectInfo | undefined {
  return services.scanner.getModel()?.projects.find((p) => p.path === projectPath);
}

function ensureInsideWorkspace(filePath: string): void {
  if (!isInsideAny(workspaceRoots(), filePath)) {
    throw new Error(`Refusing to modify a file outside the workspace: ${filePath}`);
  }
}

async function confirmModal(message: string, detail: string, action: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, action);
  return choice === action;
}

/** Resolves the dependency bucket for a package in a project (defaults to dependencies). */
function dependencyTypeFor(
  project: ProjectInfo | undefined,
  packageId: string,
  fallback: DependencyType
): DependencyType {
  return (
    project?.packages.find((p) => p.id.toLowerCase() === packageId.toLowerCase())?.dependencyType ?? fallback
  );
}

function summarize(outcome: OperationOutcome, verb: string, packageId: string): void {
  const ok = outcome.succeeded.length;
  const failed = outcome.failed.length;
  const skipped = outcome.skipped.length;
  if (failed === 0 && ok > 0) {
    const skippedNote = skipped > 0 ? ` (${skipped} skipped)` : "";
    vscode.window.showInformationMessage(`npm LL: ${verb} ${packageId} in ${ok} package(s)${skippedNote}.`);
  } else if (failed > 0) {
    vscode.window
      .showErrorMessage(
        `npm LL: failed to ${verb.toLowerCase()} ${packageId} in ${failed} package(s). See output for details.`,
        "Open Output"
      )
      .then((choice) => {
        if (choice === "Open Output") {
          logger.show();
        }
      });
  } else if (skipped > 0 && ok === 0) {
    vscode.window.showWarningMessage(`npm LL: nothing changed — ${skipped} package(s) skipped.`);
  }
}

/**
 * Installs (or updates to) a package version in one or more workspace packages.
 * `npm install` edits the target package.json and updates node_modules.
 */
export async function installPackage(
  services: NpmllServices,
  packageId: string,
  projectPaths: string[],
  version?: string,
  options: { isUpdate?: boolean; skipConfirm?: boolean; dependencyType?: DependencyType } = {}
): Promise<OperationOutcome> {
  const config = getConfig();
  const verb = options.isUpdate ? "Update" : "Install";
  const outcome: OperationOutcome = { succeeded: [], failed: [], skipped: [] };

  if (!services.npm.available) {
    vscode.window.showErrorMessage("npm LL: npm CLI not found. Package actions are disabled.");
    return outcome;
  }
  if (projectPaths.length === 0) {
    return outcome;
  }

  // skipConfirm: the dashboard webview shows its own confirmation dialog.
  if (projectPaths.length > 1 && config.confirmBeforeMultiProjectChanges && !options.skipConfirm) {
    const names = projectPaths
      .map((p) => findProject(services, p)?.name ?? p)
      .map((n) => `  • ${n}`)
      .join("\n");
    const ok = await confirmModal(
      `${verb} ${packageId}${version ? `@${version}` : ""} in ${projectPaths.length} packages?`,
      `The following package.json files will be modified:\n${names}`,
      verb
    );
    if (!ok) {
      return outcome;
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `npm LL: ${verb} ${packageId}${version ? `@${version}` : ""}`,
      cancellable: true
    },
    async (progress, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());

      for (const projectPath of projectPaths) {
        if (token.isCancellationRequested) {
          break;
        }
        ensureInsideWorkspace(projectPath);
        const project = findProject(services, projectPath);
        const name = project?.name ?? projectPath;

        // Editing a workspaces-root package.json is a shared-file change — always confirm.
        if (project?.isWorkspaceRoot) {
          const ok = await confirmModal(
            `${verb} ${packageId} in the workspaces-root package.json?`,
            projectPath,
            verb
          );
          if (!ok) {
            outcome.skipped.push({ project: name, reason: "workspaces-root change declined" });
            continue;
          }
        }

        progress.report({ message: name });
        const result = await services.cli.install(
          path.dirname(projectPath),
          packageId,
          {
            version,
            dependencyType: dependencyTypeFor(project, packageId, options.dependencyType ?? "dependencies"),
            saveExact: config.saveExact
          },
          { signal: abort.signal }
        );
        if (result.cancelled) {
          break;
        }
        if (result.code === 0) {
          outcome.succeeded.push(name);
        } else {
          outcome.failed.push({ project: name, error: (result.stderr || result.stdout).trim().slice(0, 500) });
        }
      }
    }
  );

  summarize(outcome, verb === "Install" ? "Installed" : "Updated", packageId);
  await services.scanner.scan();
  return outcome;
}

/** Removes a package from one or more workspace packages via `npm uninstall`. */
export async function removePackage(
  services: NpmllServices,
  packageId: string,
  projectPaths: string[],
  options: { skipConfirm?: boolean } = {}
): Promise<OperationOutcome> {
  const outcome: OperationOutcome = { succeeded: [], failed: [], skipped: [] };
  if (!services.npm.available) {
    vscode.window.showErrorMessage("npm LL: npm CLI not found. Package actions are disabled.");
    return outcome;
  }
  if (projectPaths.length === 0) {
    return outcome;
  }

  if (!options.skipConfirm) {
    const names = projectPaths.map((p) => findProject(services, p)?.name ?? p);
    const ok = await confirmModal(
      `Remove ${packageId} from ${names.length} package(s)?`,
      names.map((n) => `  • ${n}`).join("\n"),
      "Remove"
    );
    if (!ok) {
      return outcome;
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `npm LL: Removing ${packageId}`,
      cancellable: true
    },
    async (progress, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      for (const projectPath of projectPaths) {
        if (token.isCancellationRequested) {
          break;
        }
        ensureInsideWorkspace(projectPath);
        const project = findProject(services, projectPath);
        const name = project?.name ?? projectPath;
        if (project?.isWorkspaceRoot) {
          const ok = await confirmModal(
            `Remove ${packageId} from the workspaces-root package.json?`,
            projectPath,
            "Remove"
          );
          if (!ok) {
            outcome.skipped.push({ project: name, reason: "workspaces-root change declined" });
            continue;
          }
        }
        progress.report({ message: name });
        const result = await services.cli.uninstall(path.dirname(projectPath), packageId, { signal: abort.signal });
        if (result.cancelled) {
          break;
        }
        if (result.code === 0) {
          outcome.succeeded.push(name);
        } else {
          outcome.failed.push({ project: name, error: (result.stderr || result.stdout).trim().slice(0, 500) });
        }
      }
    }
  );

  summarize(outcome, "Removed", packageId);
  await services.scanner.scan();
  return outcome;
}

/** Runs `npm install` (no package) for a target to install all declared dependencies. */
export async function installDependencies(
  services: NpmllServices,
  projectPath?: string,
  label?: string
): Promise<boolean> {
  if (!services.npm.available) {
    vscode.window.showErrorMessage("npm LL: npm CLI not found. Install is disabled.");
    return false;
  }
  if (projectPath) {
    ensureInsideWorkspace(projectPath);
  }
  const cwd = projectPath ? path.dirname(projectPath) : workspaceRoots()[0];
  if (!cwd) {
    vscode.window.showErrorMessage("npm LL: no workspace folder is open.");
    return false;
  }
  let success = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `npm LL: Installing dependencies for ${label ?? projectPath ?? "workspace"}`,
      cancellable: true
    },
    async (_progress, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      const result = await services.cli.installAll(cwd, { signal: abort.signal });
      success = result.code === 0;
      if (result.cancelled) {
        return;
      }
      if (success) {
        vscode.window.showInformationMessage(`npm LL: dependencies installed for ${label ?? projectPath ?? "workspace"}.`);
      } else {
        vscode.window
          .showErrorMessage("npm LL: install failed. See output for details.", "Open Output")
          .then((choice) => {
            if (choice === "Open Output") {
              logger.show();
            }
          });
      }
    }
  );
  if (success) {
    await services.scanner.scan();
  }
  return success;
}
