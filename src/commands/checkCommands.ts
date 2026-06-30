import * as vscode from "vscode";
import { getConfig } from "../config";
import { OutdatedPackage } from "../models/packageModel";
import { ProjectInfo } from "../models/projectModel";
import { NpmllServices } from "../services/container";
import { logger } from "../utils/logger";

function listTargets(services: NpmllServices): ProjectInfo[] {
  return services.scanner.getModel()?.projects ?? [];
}

function reportErrors(errors: string[]): void {
  for (const error of errors) {
    logger.warn(`npm check: ${error}`);
  }
  if (errors.length > 0) {
    vscode.window.showWarningMessage("npm LL: some packages could not be analyzed. See output for details.");
  }
}

export async function runOutdatedCheck(services: NpmllServices): Promise<OutdatedPackage[] | undefined> {
  if (!services.npm.available) {
    vscode.window.showErrorMessage("npm LL: npm CLI not found.");
    return undefined;
  }
  const targets = listTargets(services);
  if (targets.length === 0) {
    vscode.window.showInformationMessage("npm LL: no package.json files found.");
    return undefined;
  }
  const config = getConfig();
  let results: OutdatedPackage[] | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "npm LL: Checking outdated packages", cancellable: true },
    async (_progress, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      const outcome = await services.vulnerabilities.checkOutdated(
        targets,
        { includeTransitive: config.showTransitivePackages },
        { signal: abort.signal }
      );
      if (token.isCancellationRequested) {
        return;
      }
      reportErrors(outcome.errors);
      services.results.setOutdated(outcome.results);
      results = outcome.results;
    }
  );
  return results;
}

export function registerCheckCommands(services: NpmllServices): vscode.Disposable[] {
  const outdated = vscode.commands.registerCommand("npmll.checkOutdated", async () => {
    const results = await runOutdatedCheck(services);
    if (results) {
      vscode.window.showInformationMessage(
        results.length === 0 ? "npm LL: all packages are up to date." : `npm LL: ${results.length} outdated package(s) found.`
      );
    }
  });

  const vulnerable = vscode.commands.registerCommand("npmll.checkVulnerable", async () => {
    if (!services.npm.available) {
      vscode.window.showErrorMessage("npm LL: npm CLI not found.");
      return;
    }
    const targets = listTargets(services);
    if (targets.length === 0) {
      vscode.window.showInformationMessage("npm LL: no package.json files found.");
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "npm LL: Checking vulnerable packages", cancellable: true },
      async (_progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        const outcome = await services.vulnerabilities.checkVulnerable(targets, { includeTransitive: true }, { signal: abort.signal });
        if (token.isCancellationRequested) {
          return;
        }
        reportErrors(outcome.errors);
        services.results.setVulnerable(outcome.results);
        vscode.window.showInformationMessage(
          outcome.results.length === 0
            ? "npm LL: no known vulnerabilities found."
            : `npm LL: ${outcome.results.length} vulnerable package(s) found.`
        );
      }
    );
  });

  const deprecated = vscode.commands.registerCommand("npmll.checkDeprecated", async () => {
    if (!services.npm.available) {
      vscode.window.showErrorMessage("npm LL: npm CLI not found.");
      return;
    }
    const targets = listTargets(services);
    if (targets.length === 0) {
      vscode.window.showInformationMessage("npm LL: no package.json files found.");
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "npm LL: Checking deprecated packages", cancellable: true },
      async (_progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        const outcome = await services.vulnerabilities.checkDeprecated(targets, {}, { signal: abort.signal });
        if (token.isCancellationRequested) {
          return;
        }
        reportErrors(outcome.errors);
        services.results.setDeprecated(outcome.results);
        if (outcome.results.length === 0) {
          vscode.window.showInformationMessage("npm LL: no deprecated packages found.");
        } else {
          const lines = outcome.results.map(
            (d) => `${d.projectName}: ${d.id} ${d.resolvedVersion} — ${d.reasons.join(", ")}`
          );
          logger.info(`Deprecated packages:\n${lines.join("\n")}`);
          vscode.window
            .showWarningMessage(`npm LL: ${outcome.results.length} deprecated package(s) found.`, "Show Details")
            .then((choice) => {
              if (choice === "Show Details") {
                logger.show();
              }
            });
        }
      }
    );
  });

  return [outdated, vulnerable, deprecated];
}
