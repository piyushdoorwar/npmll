import { DependencyType, DEPENDENCY_TYPES } from "../models/packageModel";
import { PackageSource } from "../models/sourceModel";

export interface ParsedDependency {
  id: string;
  /** Declared semver range. */
  version: string;
  dependencyType: DependencyType;
}

export interface ParsedPackageJson {
  name?: string;
  version?: string;
  /** Normalized workspace globs declared by `workspaces`, or undefined when absent. */
  workspaces?: string[];
  dependencies: ParsedDependency[];
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

/** Parses a package.json. Returns null for invalid JSON or a non-object root. */
export function parsePackageJson(content: string): ParsedPackageJson | null {
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return null;
  }
  const root = asRecord(doc);
  if (!root) {
    return null;
  }

  const dependencies: ParsedDependency[] = [];
  for (const type of DEPENDENCY_TYPES) {
    const bucket = asRecord(root[type]);
    if (!bucket) {
      continue;
    }
    for (const [id, range] of Object.entries(bucket)) {
      if (typeof range === "string") {
        dependencies.push({ id, version: range, dependencyType: type });
      }
    }
  }

  return {
    name: typeof root.name === "string" ? root.name : undefined,
    version: typeof root.version === "string" ? root.version : undefined,
    workspaces: parseWorkspaces(root.workspaces),
    dependencies
  };
}

/** Normalizes the `workspaces` field (array form or yarn's `{ packages: [...] }`). */
function parseWorkspaces(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  const record = asRecord(value);
  if (record && Array.isArray(record.packages)) {
    return (record.packages as unknown[]).filter((v): v is string => typeof v === "string");
  }
  return undefined;
}

/** Reads the `version` field from a node_modules/<pkg>/package.json body. */
export function parseInstalledVersion(content: string): string | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return undefined;
  }
  const root = asRecord(doc);
  return root && typeof root.version === "string" ? root.version : undefined;
}

// ---------------------------------------------------------------------------
// .npmrc parsing
// ---------------------------------------------------------------------------

export interface ParsedNpmrc {
  /** Maps a scope ("" = default registry) to its registry URL. */
  registries: Record<string, string>;
  /** Registry hosts (e.g. "registry.npmjs.org") that have an auth token configured. */
  authHosts: string[];
}

const SCOPED_REGISTRY = /^(@[^:=\s]+):registry\s*=\s*(.+)$/;
const DEFAULT_REGISTRY = /^registry\s*=\s*(.+)$/;
// Auth lines look like //registry.npmjs.org/:_authToken=... or :_auth=... / :_password=...
const AUTH_LINE = /^\/\/([^/:\s]+(?:\/[^:\s]*)?)\/?:_(?:authToken|auth|password)\s*=/;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/** Parses an .npmrc body. Never returns token values — only which hosts have auth. */
export function parseNpmrc(content: string): ParsedNpmrc {
  const registries: Record<string, string> = {};
  const authHosts: string[] = [];

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const scoped = SCOPED_REGISTRY.exec(line);
    if (scoped) {
      registries[scoped[1]] = stripValue(scoped[2]);
      continue;
    }
    const def = DEFAULT_REGISTRY.exec(line);
    if (def) {
      registries[""] = stripValue(def[1]);
      continue;
    }
    const auth = AUTH_LINE.exec(line);
    if (auth) {
      const host = auth[1].split("/")[0];
      if (!authHosts.includes(host)) {
        authHosts.push(host);
      }
    }
  }

  return { registries, authHosts };
}

function stripValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

/** Builds the registry source list from one or more parsed .npmrc files. */
export function npmrcToSources(parsed: ParsedNpmrc[], configPath?: string): PackageSource[] {
  const merged: ParsedNpmrc = { registries: {}, authHosts: [] };
  for (const p of parsed) {
    Object.assign(merged.registries, p.registries);
    for (const host of p.authHosts) {
      if (!merged.authHosts.includes(host)) {
        merged.authHosts.push(host);
      }
    }
  }

  const sources: PackageSource[] = [];
  for (const [scope, url] of Object.entries(merged.registries)) {
    sources.push({
      name: scope === "" ? "npm" : scope,
      url,
      enabled: true,
      scope: scope === "" ? undefined : scope,
      configPath,
      hasCredentials: merged.authHosts.includes(hostOf(url))
    });
  }
  return sources;
}
