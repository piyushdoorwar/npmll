import * as vscode from "vscode";

/** Typed access to the extension's settings. */
export function getConfig() {
  const cfg = vscode.workspace.getConfiguration("npmll");
  return {
    defaultRegistry: cfg.get<string>("defaultRegistry", ""),
    includePrerelease: cfg.get<boolean>("includePrerelease", false),
    autoRefreshOnManifestChange: cfg.get<boolean>("autoRefreshOnManifestChange", true),
    scanOnStartup: cfg.get<boolean>("scanOnStartup", true),
    showTransitivePackages: cfg.get<boolean>("showTransitivePackages", false),
    confirmBeforeMultiProjectChanges: cfg.get<boolean>("confirmBeforeMultiProjectChanges", true),
    saveExact: cfg.get<boolean>("saveExact", false),
    preferNpmCli: cfg.get<boolean>("preferNpmCli", false),
    registryApiUrl: cfg.get<string>("registryApiUrl", "https://registry.npmjs.org"),
    maxSearchResults: cfg.get<number>("maxSearchResults", 25),
    excludedFolders: cfg.get<string[]>("excludedFolders", [
      "node_modules",
      ".git",
      "dist",
      "out",
      "build",
      ".next",
      ".cache",
      ".vscode-test"
    ])
  };
}

export type NpmllConfig = ReturnType<typeof getConfig>;
