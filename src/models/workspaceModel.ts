import { ProjectInfo } from "./projectModel";
import { PackageSource } from "./sourceModel";

export interface WorkspaceModel {
  folders: string[];
  /** Workspaces-root package.json paths (the solution analog). */
  roots: string[];
  projects: ProjectInfo[];
  /** Paths of .npmrc files found in the workspace. */
  npmrcPaths: string[];
  /** Registries read from .npmrc files (and the default registry). */
  sources: PackageSource[];
  npmVersion?: string;
  nodeVersion?: string;
  scannedAt: number;
}

export function emptyWorkspaceModel(): WorkspaceModel {
  return {
    folders: [],
    roots: [],
    projects: [],
    npmrcPaths: [],
    sources: [],
    scannedAt: Date.now()
  };
}
