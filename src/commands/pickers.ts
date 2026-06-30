import * as path from "path";
import * as vscode from "vscode";
import { getConfig } from "../config";
import { DependencyType } from "../models/packageModel";
import { ProjectInfo } from "../models/projectModel";
import { NpmllServices } from "../services/container";
import { logger } from "../utils/logger";
import { isValidVersionRange } from "../utils/security";

/** Multi-select (or single-select) workspace-package picker. */
export async function pickProjects(
  services: NpmllServices,
  options: { title: string; projects?: ProjectInfo[]; preselect?: string[]; single?: boolean } = {
    title: "Select packages"
  }
): Promise<ProjectInfo[] | undefined> {
  const all = options.projects ?? services.scanner.getModel()?.projects ?? [];
  if (all.length === 0) {
    vscode.window.showWarningMessage("npm LL: no package.json files found in this workspace.");
    return undefined;
  }
  if (all.length === 1 && options.single) {
    return all;
  }
  type Item = vscode.QuickPickItem & { project: ProjectInfo };
  const items: Item[] = all.map((project) => ({
    label: project.name,
    description: project.version ? `v${project.version}` : undefined,
    detail: project.isWorkspaceRoot ? "$(symbol-namespace) workspaces root" : path.dirname(project.path),
    picked: options.preselect?.includes(project.path),
    project
  }));
  if (options.single) {
    const picked = await vscode.window.showQuickPick(items, {
      title: options.title,
      placeHolder: "Select a workspace package"
    });
    return picked ? [picked.project] : undefined;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: options.title,
    placeHolder: "Select one or more workspace packages",
    canPickMany: true
  });
  return picked && picked.length > 0 ? picked.map((i) => i.project) : undefined;
}

/** Asks for a query, searches the registry, and returns the chosen package name. */
export async function pickPackage(services: NpmllServices): Promise<string | undefined> {
  const query = await vscode.window.showInputBox({
    title: "Add npm Package",
    prompt: "Search the npm registry",
    placeHolder: "e.g. lodash"
  });
  if (!query) {
    return undefined;
  }
  const config = getConfig();
  try {
    const results = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `npm LL: Searching "${query}"...` },
      () => services.api.searchPackages(query, { take: config.maxSearchResults })
    );
    if (results.length === 0) {
      vscode.window.showInformationMessage(`npm LL: no packages found for "${query}".`);
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      results.map((r) => ({
        label: r.id,
        description: r.version,
        detail: r.description?.slice(0, 120)
      })),
      { title: "Select Package", placeHolder: query, matchOnDetail: true }
    );
    return picked?.label;
  } catch (err) {
    logger.error("Package search failed", err);
    // Network/API failure: let the user type the exact name instead.
    return vscode.window.showInputBox({
      title: "Search unavailable — enter exact package name",
      value: query,
      prompt: "The npm registry could not be reached. Enter the exact package name to install."
    });
  }
}

/** Asks which dependency bucket a package should be installed into. */
export async function pickDependencyType(): Promise<DependencyType | undefined> {
  type Item = vscode.QuickPickItem & { value: DependencyType };
  const items: Item[] = [
    { label: "dependencies", description: "runtime dependency", value: "dependencies" },
    { label: "devDependencies", description: "build/test only (--save-dev)", value: "devDependencies" },
    { label: "optionalDependencies", description: "optional (--save-optional)", value: "optionalDependencies" },
    { label: "peerDependencies", description: "peer (--save-peer)", value: "peerDependencies" }
  ];
  const picked = await vscode.window.showQuickPick(items, { title: "Dependency type" });
  return picked?.value;
}

/**
 * Version picker: latest stable / latest prerelease / pick from list / type one.
 * Returns undefined when cancelled; returns "" to mean "let npm pick latest".
 */
export async function pickVersion(
  services: NpmllServices,
  packageId: string,
  options: { currentVersion?: string } = {}
): Promise<string | undefined> {
  let versions: string[] = [];
  try {
    versions = await services.api.getVersions(packageId);
  } catch (err) {
    logger.warn(`Could not list versions for ${packageId}: ${String(err)}`);
  }
  const stable = [...versions].reverse().find((v) => !v.includes("-"));
  const prerelease = [...versions].reverse().find((v) => v.includes("-"));

  type Item = vscode.QuickPickItem & { value: string | "__pick__" | "__custom__" };
  const items: Item[] = [];
  items.push({ label: `Latest${stable ? ` (${stable})` : ""}`, value: stable ?? "" });
  if (prerelease) {
    items.push({ label: `Latest prerelease (${prerelease})`, value: prerelease });
  }
  if (versions.length > 0) {
    items.push({ label: "Pick a specific version...", value: "__pick__" });
  }
  items.push({ label: "Type a version or range...", value: "__custom__" });

  const picked = await vscode.window.showQuickPick(items, {
    title: `Version for ${packageId}`,
    placeHolder: options.currentVersion ? `Current: ${options.currentVersion}` : undefined
  });
  if (!picked) {
    return undefined;
  }
  if (picked.value === "__pick__") {
    const fromList = await vscode.window.showQuickPick(
      [...versions].reverse().map((v) => ({ label: v, description: v === options.currentVersion ? "current" : undefined })),
      { title: `Select version of ${packageId}` }
    );
    return fromList?.label;
  }
  if (picked.value === "__custom__") {
    return vscode.window.showInputBox({
      title: `Version for ${packageId}`,
      placeHolder: "e.g. 4.17.21 or ^4.0.0",
      validateInput: (value) => (isValidVersionRange(value) ? undefined : "Invalid version or range")
    });
  }
  return picked.value;
}
