import * as vscode from "vscode";
import { NpmllServices } from "../services/container";
import { installDependencies } from "../services/packageOperations";
import { pickProjects } from "./pickers";

export function registerInstallCommands(services: NpmllServices): vscode.Disposable[] {
  const workspace = vscode.commands.registerCommand("npmll.installDependencies", async () => {
    await installDependencies(services, undefined, "workspace");
  });

  const project = vscode.commands.registerCommand("npmll.installProject", async (projectPath?: string) => {
    let target = projectPath;
    if (!target) {
      const picked = await pickProjects(services, { title: "Install Dependencies", single: true });
      if (!picked) {
        return;
      }
      target = picked[0].path;
    }
    await installDependencies(services, target);
  });

  return [workspace, project];
}
