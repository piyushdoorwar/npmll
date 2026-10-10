import * as fs from "fs";
import * as path from "path";
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

/**
 * npm reports failures (no lockfile, registry/auth errors) as `{"error": {...}}`
 * on stdout. That parses fine, so it must be treated as a failure explicitly or
 * the check would look like a clean result.
 */
function isNpmError(doc: unknown): boolean {
  const error = (doc as { error?: unknown } | null)?.error;
  return (
    typeof error === "object" &&
    error !== null &&
    !("latest" in error) &&
    ("code" in error || "summary" in error)
  );
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
  if (!doc || isNpmError(doc)) {
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

/**
 * True when an `npm outdated` entry is not one of the project's own direct
 * dependencies. npm's JSON `location` is an absolute path, so hoisted
 * transitive packages can't be told apart by nesting; use the declaration and
 * the depending package instead.
 */
export function isTransitiveOutdated(
  entry: { dependent?: string },
  isDeclared: boolean,
  projectNames: string[]
): boolean {
  if (!isDeclared) {
    return true;
  }
  return entry.dependent !== undefined && !projectNames.includes(entry.dependent);
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
  if (!doc || isNpmError(doc)) {
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

/**
 * Works out how to start npm without a shell. On Windows `npm` is an `npm.cmd`
 * shim, which `spawn` cannot run unless a shell is involved, so run the
 * `npm-cli.js` that ships next to it with node instead.
 */
export function resolveNpmLauncher(
  platform: NodeJS.Platform = process.platform,
  pathEnv: string = process.env.PATH ?? "",
  exists: (file: string) => boolean = fs.existsSync
): { command: string; prefixArgs: string[] } {
  if (platform !== "win32") {
    return { command: "npm", prefixArgs: [] };
  }
  for (const dir of pathEnv.split(";").filter(Boolean)) {
    if (!exists(path.win32.join(dir, "npm.cmd"))) {
      continue;
    }
    const cli = path.win32.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
    if (!exists(cli)) {
      continue;
    }
    const node = path.win32.join(dir, "node.exe");
    return { command: exists(node) ? node : "node", prefixArgs: [cli] };
  }
  return { command: "npm", prefixArgs: [] };
}

export class NpmCliService {
  private readonly launcher: { command: string; prefixArgs: string[] };
  // Commands that write package.json / package-lock.json run one at a time, so
  // a batch of updates can't race each other on the same files.
  private mutations: Promise<unknown> = Promise.resolve();

  constructor(private readonly log: CliLogSink, launcher = resolveNpmLauncher()) {
    this.launcher = launcher;
  }

  run(args: string[], options: RunOptions = {}): Promise<CommandResult> {
    return runCommand(this.launcher.command, [...this.launcher.prefixArgs, ...args], { ...options, onLog: this.log });
  }

  private runExclusive(args: string[], options: RunOptions): Promise<CommandResult> {
    const next = this.mutations.then(() => this.run(args, options));
    this.mutations = next.catch(() => undefined);
    return next;
  }

  async detectNpm(): Promise<{ available: boolean; version?: string }> {
    const { command, prefixArgs } = this.launcher;
    const result = await runCommand(command, [...prefixArgs, "--version"], { timeoutMs: 15000 });
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
    return this.runExclusive(buildInstallArgs(packageId, options), { ...runOptions, cwd });
  }

  uninstall(cwd: string, packageId: string, runOptions: RunOptions = {}): Promise<CommandResult> {
    return this.runExclusive(buildUninstallArgs(packageId), { ...runOptions, cwd });
  }

  installAll(cwd: string, runOptions: RunOptions = {}): Promise<CommandResult> {
    return this.runExclusive(buildInstallAllArgs(), { ...runOptions, cwd });
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
