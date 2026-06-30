import { PackageReference } from "./packageModel";

/**
 * A workspace package: one package.json (the root package.json, or a member of
 * a `workspaces` monorepo). This is the npm analog of NuGet LL's per-project
 * unit — the root package.json plays the role the solution did.
 */
export interface ProjectInfo {
  /** package.json `name`, falling back to the containing directory name. */
  name: string;
  /** Absolute path to the package.json. */
  path: string;
  /** Declared version from package.json. */
  version?: string;
  /** True for the workspaces-root package.json that declares `workspaces`. */
  isWorkspaceRoot: boolean;
  /** True when a node_modules directory exists alongside this package.json. */
  hasNodeModules: boolean;
  packages: PackageReference[];
}
