import {
  PackageDependency,
  PackageDependencyGroup,
  PackageDetails,
  PackageSearchResult,
  PackageVersionInfo
} from "../models/packageModel";

const FETCH_TIMEOUT_MS = 15000;

interface PackumentVersion {
  name?: string;
  version?: string;
  description?: string;
  deprecated?: string;
  license?: string | { type?: string };
  homepage?: string;
  author?: { name?: string } | string;
  keywords?: string[];
  repository?: { url?: string } | string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Packument {
  name?: string;
  description?: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, PackumentVersion>;
  homepage?: string;
  license?: string | { type?: string };
  author?: { name?: string } | string;
  keywords?: string[];
  repository?: { url?: string } | string;
  maintainers?: { name?: string }[];
}

interface SearchResponse {
  objects?: {
    package?: {
      name: string;
      version?: string;
      description?: string;
      keywords?: string[];
      links?: { npm?: string; homepage?: string; repository?: string };
      author?: { name?: string };
      publisher?: { username?: string };
    };
  }[];
}

function isPrerelease(version: string): boolean {
  return version.includes("-");
}

function licenseString(value: string | { type?: string } | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return typeof value === "string" ? value : value.type;
}

function repoUrl(value: { url?: string } | string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const raw = typeof value === "string" ? value : value.url;
  return raw ? raw.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://") : undefined;
}

function authorName(value: { name?: string } | string | undefined): string[] {
  if (!value) {
    return [];
  }
  const name = typeof value === "string" ? value : value.name;
  return name ? [name] : [];
}

/** Encodes a package name for a registry URL path (scoped names keep their @ but encode the slash). */
function encodeName(packageId: string): string {
  return packageId.startsWith("@") ? packageId.replace("/", "%2F") : encodeURIComponent(packageId);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Talks to an npm registry HTTP API (registry.npmjs.org by default). All
 * methods throw on network failure; callers decide whether to fall back to the
 * npm CLI. Private/scoped-registry auth tokens are never read, so requests are
 * unauthenticated — private packages fall back to the CLI.
 */
export class NpmApiService {
  private packumentCache = new Map<string, Packument>();

  constructor(private readonly getRegistryUrl: () => string) {}

  private base(registryUrl?: string): string {
    return (registryUrl ?? this.getRegistryUrl()).replace(/\/$/, "");
  }

  private async getPackument(packageId: string, registryUrl?: string): Promise<Packument> {
    const url = `${this.base(registryUrl)}/${encodeName(packageId)}`;
    let packument = this.packumentCache.get(url);
    if (!packument) {
      packument = await fetchJson<Packument>(url);
      this.packumentCache.set(url, packument);
    }
    return packument;
  }

  async searchPackages(
    query: string,
    options: { take?: number; skip?: number; registryUrl?: string; sourceName?: string } = {}
  ): Promise<PackageSearchResult[]> {
    const params = new URLSearchParams({
      text: query,
      size: String(options.take ?? 25),
      from: String(options.skip ?? 0)
    });
    const data = await fetchJson<SearchResponse>(`${this.base(options.registryUrl)}/-/v1/search?${params}`);
    const sourceName = options.sourceName ?? "npm";
    return (data.objects ?? [])
      .map((o) => o.package)
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((pkg) => ({
        id: pkg.name,
        version: pkg.version ?? "",
        description: pkg.description,
        authors: pkg.author?.name ? [pkg.author.name] : [],
        owners: pkg.publisher?.username ? [pkg.publisher.username] : undefined,
        tags: pkg.keywords ?? [],
        projectUrl: pkg.links?.homepage ?? pkg.links?.repository ?? pkg.links?.npm,
        source: sourceName
      }));
  }

  /** Lists all published versions (oldest first). */
  async getVersions(packageId: string, registryUrl?: string): Promise<string[]> {
    const packument = await this.getPackument(packageId, registryUrl);
    return Object.keys(packument.versions ?? {});
  }

  /** Maps version -> deprecation message for every deprecated version (batch, one request). */
  async getDeprecatedVersions(packageId: string, registryUrl?: string): Promise<Record<string, string>> {
    const packument = await this.getPackument(packageId, registryUrl);
    const deprecated: Record<string, string> = {};
    for (const [version, entry] of Object.entries(packument.versions ?? {})) {
      if (typeof entry.deprecated === "string" && entry.deprecated.length > 0) {
        deprecated[version] = entry.deprecated;
      }
    }
    return deprecated;
  }

  async getPackageDetails(
    packageId: string,
    options: { registryUrl?: string; sourceName?: string } = {}
  ): Promise<PackageDetails> {
    const packument = await this.getPackument(packageId, options.registryUrl);
    const versionMap = packument.versions ?? {};
    const versionKeys = Object.keys(versionMap);
    if (versionKeys.length === 0) {
      throw new Error(`Package '${packageId}' was not found on the registry.`);
    }

    const distTags = packument["dist-tags"] ?? {};
    const latestTag = distTags.latest ?? versionKeys[versionKeys.length - 1];
    const latest = versionMap[latestTag] ?? versionMap[versionKeys[versionKeys.length - 1]];

    const versions: PackageVersionInfo[] = versionKeys
      .map((v) => ({ version: v, isPrerelease: isPrerelease(v) }))
      .reverse();
    const latestStableVersion = !isPrerelease(latestTag) ? latestTag : versions.find((v) => !v.isPrerelease)?.version;
    const latestPrereleaseVersion = versions.find((v) => v.isPrerelease)?.version;

    const dependencyGroups: PackageDependencyGroup[] = [];
    const addGroup = (name: string, deps?: Record<string, string>) => {
      const entries: PackageDependency[] = Object.entries(deps ?? {}).map(([id, range]) => ({ id, range }));
      if (entries.length > 0) {
        dependencyGroups.push({ name, dependencies: entries });
      }
    };
    addGroup("dependencies", latest.dependencies);
    addGroup("peerDependencies", latest.peerDependencies);
    addGroup("optionalDependencies", latest.optionalDependencies);

    return {
      id: packument.name ?? packageId,
      version: latestTag,
      description: latest.description ?? packument.description,
      authors: authorName(latest.author).length > 0 ? authorName(latest.author) : authorName(packument.author),
      owners: packument.maintainers?.map((m) => m.name ?? "").filter(Boolean),
      tags: latest.keywords ?? packument.keywords ?? [],
      projectUrl: latest.homepage ?? packument.homepage ?? repoUrl(packument.repository),
      source: options.sourceName ?? "npm",
      licenseExpression: licenseString(latest.license) ?? licenseString(packument.license),
      repositoryUrl: repoUrl(latest.repository) ?? repoUrl(packument.repository),
      latestStableVersion,
      latestPrereleaseVersion,
      versions,
      deprecation: latest.deprecated
        ? { reasons: ["Deprecated"], message: latest.deprecated }
        : undefined,
      vulnerabilities: [],
      dependencyGroups,
      usedInProjects: []
    };
  }
}
