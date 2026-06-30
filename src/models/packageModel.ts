/** The npm dependency buckets a package can be declared in. */
export type DependencyType =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

export const DEPENDENCY_TYPES: DependencyType[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
];

/** A dependency declared by a package.json. */
export interface PackageReference {
  /** Package name, e.g. "react" or "@scope/pkg". */
  id: string;
  /** Declared semver range from package.json (e.g. "^18.2.0"). */
  version?: string;
  /** Version actually present in node_modules/<id>/package.json, when installed. */
  resolvedVersion?: string;
  /** Which dependency bucket the entry came from. */
  dependencyType: DependencyType;
  /** True when the declared package is present in node_modules. */
  isInstalled: boolean;
  /** True for deep (non-declared) dependencies surfaced by checks. */
  isTransitive?: boolean;
}

export interface PackageSearchResult {
  id: string;
  version: string;
  description?: string;
  iconUrl?: string;
  /** Weekly downloads, when the registry reports them. */
  totalDownloads?: number;
  verified?: boolean;
  authors: string[];
  owners?: string[];
  tags: string[];
  projectUrl?: string;
  /** Display name of the registry this result came from. */
  source: string;
}

export interface PackageVersionInfo {
  version: string;
  downloads?: number;
  isPrerelease: boolean;
}

export interface PackageDependency {
  id: string;
  range: string;
}

/** A bucket of dependencies declared by a published package (e.g. "dependencies", "peerDependencies"). */
export interface PackageDependencyGroup {
  name: string;
  dependencies: PackageDependency[];
}

export interface PackageDeprecationInfo {
  reasons: string[];
  message?: string;
  alternativePackageId?: string;
  alternativePackageRange?: string;
}

export interface PackageVulnerabilityInfo {
  severity: string;
  advisoryUrl: string;
}

export interface PackageDetails extends PackageSearchResult {
  /** SPDX license expression (npm `license` field). */
  licenseExpression?: string;
  licenseUrl?: string;
  repositoryUrl?: string;
  latestStableVersion?: string;
  latestPrereleaseVersion?: string;
  versions: PackageVersionInfo[];
  deprecation?: PackageDeprecationInfo;
  vulnerabilities?: PackageVulnerabilityInfo[];
  dependencyGroups: PackageDependencyGroup[];
  /** Workspace packages that declare this dependency. */
  usedInProjects: { name: string; path: string; version?: string }[];
}

export interface OutdatedPackage {
  id: string;
  projectName: string;
  projectPath: string;
  /** Declared semver range from package.json. */
  requestedVersion?: string;
  /** Version installed in node_modules (npm "current"). */
  resolvedVersion: string;
  /** Highest version satisfying the declared range (npm "wanted"). */
  wantedVersion?: string;
  /** Latest published version (npm "latest"). */
  latestVersion: string;
  dependencyType?: DependencyType;
  isTransitive?: boolean;
}

export interface VulnerablePackage {
  id: string;
  projectName: string;
  projectPath: string;
  resolvedVersion: string;
  severity: string;
  advisoryUrl: string;
  /** Short advisory title, when reported. */
  title?: string;
  /** Affected version range from the advisory. */
  vulnerableRange?: string;
  isTransitive?: boolean;
}

export interface DeprecatedPackage {
  id: string;
  projectName: string;
  projectPath: string;
  resolvedVersion: string;
  reasons: string[];
  alternativeId?: string;
  alternativeVersionRange?: string;
}
