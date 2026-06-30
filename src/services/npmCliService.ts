import { DependencyType, PackageSearchResult } from "../models/packageModel";
import { CommandResult, runCommand, RunOptions } from "./commandRunner";

// ---------------------------------------------------------------------------
// Pure argument builders (unit-tested; keep them side-effect free).
// ---------------------------------------------------------------------------

const SAVE_FLAG: Record<DependencyType, string> = {
  dependencies: "--save-prod",
  devDependencies: "--save-dev",
  peerDependencies: "--save-peer",
  optionalDependencies: "--save-optional"
};

export function buildInstallArgs(
  packageId: string,
  options: { version?: string; dependencyType?: DependencyType; saveExact?: boolean } = {}
): string[] {
  const spec = options.version ? `${packageId}@${options.version}` : packageId;
  const args = ["install", spec, SAVE_FLAG[options.dependencyType ?? "dependencies"]];
  if (options.saveExact) {
    args.push("--save-exact");
  }
  return args;
}

export function buildUninstallArgs(packageId: string): string[] {
  return ["uninstall", packageId];
}

/** `npm install` with no package — installs everything declared (the "restore" analog). */
export function buildInstallAllArgs(): string[] {
  return ["install"];
}

export function buildOutdatedArgs(options: { includeTransitive?: boolean } = {}): string[] {
  const args = ["outdated", "--json"];
  if (options.includeTransitive) {
    args.push("--all");
  }
  return args;
}

export function buildAuditArgs(): string[] {
  return ["audit", "--json"];
}

export function buildSearchArgs(query: string, options: { take?: number } = {}): string[] {
  const args = ["search", query, "--json"];
  if (options.take) {
    args.push("--searchlimit", String(options.take));
  }
  return args;
}

export function buildViewArgs(packageId: string, field?: string): string[] {
  const args = ["view", packageId];
  if (field) {
    args.push(field);
  }
  args.push("--json");
  return args;
}

// ---------------------------------------------------------------------------
// Pure output parsers.
// ---------------------------------------------------------------------------

export interface NpmOutdatedEntry {
  id: string;
  current?: string;
  wanted: string;
  latest: string;
  location?: string;
  dependent?: string;
}

interface RawOutdated {
  current?: string;
  wanted?: string;
  latest?: string;
  location?: string;
  dependent?: string;
}

function tryParse<T>(stdout: string): T | null {
  const start = stdout.search(/[[{]/);
  if (start < 0) {
    return null;
  }
  try {
    return JSON.parse(stdout.slice(start)) as T;
  } catch {
    return null;
  }
}

/**
 * Parses `npm outdated --json`. The body is an object keyed by package name;
 * each value is a record (or an array of records when a package resolves to
 * multiple versions). Empty output means nothing is outdated.
 */
export function parseOutdatedJson(stdout: string): NpmOutdatedEntry[] | null {
  if (stdout.trim().length === 0) {
    return [];
  }
  const doc = tryParse<Record<string, RawOutdated | RawOutdated[]>>(stdout);
  if (!doc) {
    return null;
  }
  const result: NpmOutdatedEntry[] = [];
  for (const [id, value] of Object.entries(doc)) {
    for (const raw of Array.isArray(value) ? value : [value]) {
      if (!raw || typeof raw !== "object" || !raw.latest) {
        continue;
      }
      result.push({
        id,
        current: raw.current,
        wanted: raw.wanted ?? raw.latest,
        latest: raw.latest,
        location: raw.location,
        dependent: raw.dependent
      });
    }
  }
  return result;
}

/** True when an npm install location is nested (a transitive dependency). */
export function isTransitiveLocation(location?: string): boolean {
  if (!location) {
    return false;
  }
  return (location.match(/node_modules/g) ?? []).length > 1;
}

export interface NpmAuditEntry {
  id: string;
  severity: string;
  isDirect: boolean;
  title?: string;
  url?: string;
  range?: string;
}

interface RawAuditVia {
  title?: string;
  url?: string;
  severity?: string;
  range?: string;
}

interface RawAuditVuln {
  name?: string;
  severity?: string;
  isDirect?: boolean;
  via?: (string | RawAuditVia)[];
  range?: string;
}

interface RawAuditV7 {
  vulnerabilities?: Record<string, RawAuditVuln>;
}

interface RawAdvisoryV6 {
  module_name?: string;
  severity?: string;
  title?: string;
  url?: string;
  vulnerable_versions?: string;
}

interface RawAuditV6 {
  advisories?: Record<string, RawAdvisoryV6>;
}

/** Parses `npm audit --json` (npm v7+ `vulnerabilities`, with a v6 `advisories` fallback). */
export function parseAuditJson(stdout: string): NpmAuditEntry[] | null {
  const doc = tryParse<RawAuditV7 & RawAuditV6>(stdout);
  if (!doc) {
    return null;
  }
  const result: NpmAuditEntry[] = [];

  if (doc.vulnerabilities) {
    for (const [id, vuln] of Object.entries(doc.vulnerabilities)) {
      const detail = (vuln.via ?? []).find(
        (v): v is RawAuditVia => typeof v === "object"
      );
      result.push({
        id: vuln.name ?? id,
        severity: vuln.severity ?? detail?.severity ?? "unknown",
        isDirect: vuln.isDirect ?? false,
        title: detail?.title,
        url: detail?.url,
        range: vuln.range ?? detail?.range
      });
    }
    return result;
  }

  if (doc.advisories) {
    for (const advisory of Object.values(doc.advisories)) {
      result.push({
        id: advisory.module_name ?? "",
        severity: advisory.severity ?? "unknown",
        isDirect: true,
        title: advisory.title,
        url: advisory.url,
        range: advisory.vulnerable_versions
      });
    }
    return result;
  }

  return result;
}

interface RawSearchItem {
  name: string;
  version?: string;
  description?: string;
  keywords?: string[];
  author?: { name?: string } | string;
  publisher?: { username?: string };
  links?: { npm?: string; homepage?: string; repository?: string };
}

export function parseSearchJson(stdout: string): PackageSearchResult[] | null {
  const doc = tryParse<RawSearchItem[]>(stdout);
  if (!doc || !Array.isArray(doc)) {
    return null;
  }
  return doc.map((item) => {
    const authorName = typeof item.author === "string" ? item.author : item.author?.name;
    return {
      id: item.name,
      version: item.version ?? "",
      description: item.description,
      authors: authorName ? [authorName] : [],
      owners: item.publisher?.username ? [item.publisher.username] : undefined,
      tags: item.keywords ?? [],
      projectUrl: item.links?.homepage ?? item.links?.repository ?? item.links?.npm,
      source: "npm"
    };
  });
}

/** Parses `npm view <pkg> versions --json` (array, or a single string). */
export function parseViewVersionsJson(stdout: string): string[] | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof doc === "string") {
    return [doc];
  }
  return Array.isArray(doc) ? doc : null;
}

/** Extracts a version from `npm --version` / `node --version` output. */
export function parseCliVersion(stdout: string): string | undefined {
  const line = stdout.trim().split(/\r?\n/)[0]?.trim().replace(/^v/, "");
  return line && /^\d+\.\d+/.test(line) ? line : undefined;
}

// ---------------------------------------------------------------------------
// Service wrapping the npm CLI.
// ---------------------------------------------------------------------------

export interface CliLogSink {
  (line: string): void;
}

export class NpmCliService {
  constructor(private readonly log: CliLogSink, private readonly npmPath = "npm") {}

  run(args: string[], options: RunOptions = {}): Promise<CommandResult> {
    return runCommand(this.npmPath, args, { ...options, onLog: this.log });
  }

  async detectNpm(): Promise<{ available: boolean; version?: string }> {
    const result = await runCommand(this.npmPath, ["--version"], { timeoutMs: 15000 });
    if (result.spawnError || result.code !== 0) {
      return { available: false };
    }
    return { available: true, version: parseCliVersion(result.stdout) };
  }

  async detectNode(): Promise<string | undefined> {
    const result = await runCommand("node", ["--version"], { timeoutMs: 15000 });
    if (result.spawnError || result.code !== 0) {
      return undefined;
    }
    return parseCliVersion(result.stdout);
  }

  install(
    cwd: string,
    packageId: string,
    options: { version?: string; dependencyType?: DependencyType; saveExact?: boolean } = {},
    runOptions: RunOptions = {}
  ): Promise<CommandResult> {
    return this.run(buildInstallArgs(packageId, options), { ...runOptions, cwd });
  }

  uninstall(cwd: string, packageId: string, runOptions: RunOptions = {}): Promise<CommandResult> {
    return this.run(buildUninstallArgs(packageId), { ...runOptions, cwd });
  }

  installAll(cwd: string, runOptions: RunOptions = {}): Promise<CommandResult> {
    return this.run(buildInstallAllArgs(), { ...runOptions, cwd });
  }

  outdated(cwd: string, options: { includeTransitive?: boolean } = {}, runOptions: RunOptions = {}): Promise<CommandResult> {
    return this.run(buildOutdatedArgs(options), { ...runOptions, cwd });
  }

  audit(cwd: string, runOptions: RunOptions = {}): Promise<CommandResult> {
    return this.run(buildAuditArgs(), { ...runOptions, cwd });
  }

  search(query: string, options: { take?: number } = {}, runOptions: RunOptions = {}): Promise<CommandResult> {
    return this.run(buildSearchArgs(query, options), runOptions);
  }

  view(packageId: string, field?: string, runOptions: RunOptions = {}): Promise<CommandResult> {
    return this.run(buildViewArgs(packageId, field), runOptions);
  }
}
