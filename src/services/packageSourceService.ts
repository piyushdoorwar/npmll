import { PackageSource } from "../models/sourceModel";
import { WorkspaceScanner } from "./workspaceScanner";

/**
 * Surfaces the npm registries configured for the workspace. Registries come
 * from .npmrc files (workspace and user level) parsed during the workspace
 * scan — npm LL reads them but never writes registries or auth tokens, mirroring
 * how NuGet LL relied on credential providers rather than persisting secrets.
 */
export class PackageSourceService {
  constructor(private readonly scanner: WorkspaceScanner) {}

  async listSources(): Promise<PackageSource[]> {
    const model = this.scanner.getModel();
    if (model && model.sources.length > 0) {
      return model.sources;
    }
    // Before the first scan completes, report the public registry.
    return [{ name: "npm", url: "https://registry.npmjs.org/", enabled: true }];
  }
}
