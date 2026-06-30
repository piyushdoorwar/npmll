import * as vscode from "vscode";
import { NpmllServices } from "../services/container";
import { installPackage } from "../services/packageOperations";
import { pickDependencyType, pickPackage, pickProjects, pickVersion } from "./pickers";

export function registerAddPackageCommand(services: NpmllServices): vscode.Disposable {
  return vscode.commands.registerCommand("npmll.addPackage", async () => {
    const packageId = await pickPackage(services);
    if (!packageId) {
      return;
    }

    const projects = await pickProjects(services, { title: `Install ${packageId} into...` });
    if (!projects) {
      return;
    }
    const projectPaths = projects.map((p) => p.path);

    const dependencyType = await pickDependencyType();
    if (dependencyType === undefined) {
      return;
    }

    const version = await pickVersion(services, packageId);
    if (version === undefined) {
      return;
    }
    await installPackage(services, packageId, projectPaths, version || undefined, { dependencyType });
  });
}
