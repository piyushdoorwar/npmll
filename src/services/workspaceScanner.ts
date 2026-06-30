import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { PackageReference } from "../models/packageModel";
import { ProjectInfo } from "../models/projectModel";
import { PackageSource } from "../models/sourceModel";
import { WorkspaceModel } from "../models/workspaceModel";
import { ancestorDirs } from "../utils/pathUtils";
import {
  npmrcToSources,
  parseInstalledVersion,
  parseNpmrc,
  parsePackageJson
} from "./projectParser";

export interface ScanFileSet {
  packageJsons: string[];
  npmrcs: string[];
}

/** Recursively collects package.json and .npmrc files, skipping excluded folders. */
export async function collectFiles(root: string, excludedFolders: string[]): Promise<ScanFileSet> {
  // node_modules is always excluded — recursing into it would surface every
  // transitive dependency as a project.
  const excluded = new Set([...excludedFolders.map((f) => f.toLowerCase()), "node_modules"]);
  const found: ScanFileSet = { packageJsons: [], npmrcs: [] };

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip silently
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name.toLowerCase())) {
          await walk(full);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (lower === "package.json") {
        found.packageJsons.push(full);
      } else if (lower === ".npmrc") {
        found.npmrcs.push(full);
      }
    }
  }

  await walk(root);
  return found;
}

async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolves the installed version of a package by reading its
 * node_modules/<id>/package.json. Walks up ancestor directories so hoisted
 * dependencies (installed at the workspace root) are still found.
 */
async function resolveInstalledVersion(
  projectDir: string,
  scanRoot: string,
  packageId: string
): Promise<string | undefined> {
  for (const dir of ancestorDirs(path.join(projectDir, "x"), scanRoot)) {
    const manifest = path.join(dir, "node_modules", ...packageId.split("/"), "package.json");
    const content = await readTextOrNull(manifest);
    if (content !== null) {
      return parseInstalledVersion(content);
    }
  }
  return undefined;
}

export interface ScanIssue {
  file: string;
  message: string;
}

export interface ScanResult {
  model: WorkspaceModel;
  issues: ScanIssue[];
}

/**
 * Scans the given workspace folders and builds the in-memory model.
 * Pure Node implementation (fs only) so it is unit-testable outside VS Code.
 */
export async function scanWorkspaceFolders(
  folders: string[],
  excludedFolders: string[]
): Promise<ScanResult> {
  const issues: ScanIssue[] = [];
  const roots: string[] = [];
  const projects: ProjectInfo[] = [];
  const npmrcPaths: string[] = [];

  for (const folder of folders) {
    const files = await collectFiles(folder, excludedFolders);
    npmrcPaths.push(...files.npmrcs);

    for (const manifestPath of files.packageJsons) {
      const content = await readTextOrNull(manifestPath);
      const parsed = content !== null ? parsePackageJson(content) : null;
      if (!parsed) {
        issues.push({ file: manifestPath, message: "Could not parse package.json (invalid JSON?)" });
        continue;
      }

      const projectDir = path.dirname(manifestPath);
      const hasNodeModules = await dirExists(path.join(projectDir, "node_modules"));

      const packages: PackageReference[] = [];
      for (const dep of parsed.dependencies) {
        const resolvedVersion = await resolveInstalledVersion(projectDir, folder, dep.id);
        packages.push({
          id: dep.id,
          version: dep.version,
          resolvedVersion,
          dependencyType: dep.dependencyType,
          isInstalled: resolvedVersion !== undefined
        });
      }

      const project: ProjectInfo = {
        name: parsed.name ?? path.basename(projectDir),
        path: manifestPath,
        version: parsed.version,
        isWorkspaceRoot: parsed.workspaces !== undefined,
        hasNodeModules,
        packages
      };
      if (project.isWorkspaceRoot) {
        roots.push(manifestPath);
      }
      projects.push(project);
    }
  }

  const sources = await readRegistrySources(npmrcPaths);

  projects.sort((a, b) => a.name.localeCompare(b.name));

  return {
    model: {
      folders,
      roots,
      projects,
      npmrcPaths,
      sources,
      scannedAt: Date.now()
    },
    issues
  };
}

/**
 * Reads registries from workspace .npmrc files plus the user-level ~/.npmrc,
 * always including the public npm registry as the default fallback.
 */
async function readRegistrySources(npmrcPaths: string[]): Promise<PackageSource[]> {
  const sources: PackageSource[] = [];
  const seen = new Set<string>();
  const add = (list: PackageSource[]) => {
    for (const source of list) {
      const key = (source.scope ?? "").toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(source);
      }
    }
  };

  for (const npmrcPath of npmrcPaths) {
    const content = await readTextOrNull(npmrcPath);
    if (content !== null) {
      add(npmrcToSources([parseNpmrc(content)], npmrcPath));
    }
  }

  const userNpmrc = path.join(os.homedir(), ".npmrc");
  if (!npmrcPaths.includes(userNpmrc)) {
    const content = await readTextOrNull(userNpmrc);
    if (content !== null) {
      add(npmrcToSources([parseNpmrc(content)], userNpmrc));
    }
  }

  if (!seen.has("")) {
    sources.unshift({ name: "npm", url: "https://registry.npmjs.org/", enabled: true });
  }
  return sources;
}

export type ModelListener = (model: WorkspaceModel) => void;

/**
 * Stateful scanner with change notification. Folder/exclusion lookups are
 * injected so the class stays free of the `vscode` module and unit-testable.
 */
export class WorkspaceScanner {
  private model: WorkspaceModel | undefined;
  private listeners: ModelListener[] = [];
  private scanning: Promise<ScanResult> | undefined;

  constructor(
    private readonly getFolders: () => string[],
    private readonly getExcludedFolders: () => string[]
  ) {}

  getModel(): WorkspaceModel | undefined {
    return this.model;
  }

  onDidChangeModel(listener: ModelListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Runs a scan; concurrent calls share the in-flight scan. */
  async scan(): Promise<ScanResult> {
    if (this.scanning) {
      return this.scanning;
    }
    this.scanning = scanWorkspaceFolders(this.getFolders(), this.getExcludedFolders())
      .then((result) => {
        this.model = result.model;
        for (const listener of this.listeners) {
          listener(result.model);
        }
        return result;
      })
      .finally(() => {
        this.scanning = undefined;
      });
    return this.scanning;
  }
}
