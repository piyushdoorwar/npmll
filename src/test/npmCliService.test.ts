import { describe, expect, it } from "vitest";
import {
  buildInstallArgs,
  buildOutdatedArgs,
  buildSearchArgs,
  buildUninstallArgs,
  buildViewArgs,
  isTransitiveOutdated,
  parseAuditJson,
  parseCliVersion,
  parseOutdatedJson,
  parseSearchJson,
  parseViewVersionsJson,
  resolveNpmLauncher
} from "../services/npmCliService";
import { compareVersions } from "../services/npmApiService";

describe("buildInstallArgs", () => {
  it("pins the version and selects the save flag by dependency type", () => {
    expect(buildInstallArgs("react", { version: "18.2.0", dependencyType: "dependencies" })).toEqual([
      "install",
      "react@18.2.0",
      "--save-prod"
    ]);
    expect(buildInstallArgs("vitest", { dependencyType: "devDependencies" })).toEqual([
      "install",
      "vitest",
      "--save-dev"
    ]);
    expect(buildInstallArgs("ts", { version: "5.0.0", dependencyType: "peerDependencies", saveExact: true })).toEqual([
      "install",
      "ts@5.0.0",
      "--save-peer",
      "--save-exact"
    ]);
  });
});

describe("buildUninstallArgs / buildOutdatedArgs / buildSearchArgs / buildViewArgs", () => {
  it("builds the expected argument arrays", () => {
    expect(buildUninstallArgs("lodash")).toEqual(["uninstall", "lodash"]);
    expect(buildOutdatedArgs()).toEqual(["outdated", "--json"]);
    expect(buildOutdatedArgs({ includeTransitive: true })).toEqual(["outdated", "--json", "--all"]);
    expect(buildSearchArgs("react", { take: 10 })).toEqual(["search", "react", "--json", "--searchlimit", "10"]);
    expect(buildViewArgs("react", "versions")).toEqual(["view", "react", "versions", "--json"]);
  });
});

describe("parseOutdatedJson", () => {
  it("returns an empty list when nothing is outdated", () => {
    expect(parseOutdatedJson("")).toEqual([]);
    expect(parseOutdatedJson("{}")).toEqual([]);
  });

  it("parses outdated entries", () => {
    const out = parseOutdatedJson(
      JSON.stringify({
        lodash: { current: "4.17.20", wanted: "4.17.21", latest: "4.17.21", location: "node_modules/lodash", dependent: "app" }
      })
    );
    expect(out).toEqual([
      {
        id: "lodash",
        current: "4.17.20",
        wanted: "4.17.21",
        latest: "4.17.21",
        location: "node_modules/lodash",
        dependent: "app"
      }
    ]);
  });

  it("handles array-valued entries", () => {
    const out = parseOutdatedJson(JSON.stringify({ x: [{ wanted: "2.0.0", latest: "3.0.0" }] }));
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ id: "x", latest: "3.0.0" });
  });

  it("returns null for non-JSON output", () => {
    expect(parseOutdatedJson("npm ERR! something")).toBeNull();
  });
});

describe("isTransitiveOutdated", () => {
  it("treats the project's own declared dependencies as direct", () => {
    expect(isTransitiveOutdated({ dependent: "api" }, true, ["api", "api-dir"])).toBe(false);
    expect(isTransitiveOutdated({}, true, ["api"])).toBe(false);
  });

  it("treats undeclared or other packages' dependencies as transitive, even when hoisted", () => {
    expect(isTransitiveOutdated({ dependent: "api" }, false, ["api"])).toBe(true);
    expect(isTransitiveOutdated({ dependent: "body-parser" }, true, ["api"])).toBe(true);
  });
});

describe("npm error output", () => {
  const error = JSON.stringify({ error: { code: "ENOLOCK", summary: "This command requires an existing lockfile." } });

  it("reports a failed audit instead of no vulnerabilities", () => {
    expect(parseAuditJson(error)).toBeNull();
  });

  it("reports a failed outdated check instead of everything up to date", () => {
    expect(parseOutdatedJson(error)).toBeNull();
  });

  it("still parses an outdated package that is literally named error", () => {
    const doc = JSON.stringify({ error: { current: "1.0.0", wanted: "1.0.1", latest: "2.0.0" } });
    expect(parseOutdatedJson(doc)).toHaveLength(1);
  });
});

describe("resolveNpmLauncher", () => {
  it("uses npm directly off Windows", () => {
    expect(resolveNpmLauncher("linux", "/usr/bin", () => true)).toEqual({ command: "npm", prefixArgs: [] });
  });

  it("runs npm-cli.js with the bundled node on Windows", () => {
    const files = new Set([
      "C:\\Program Files\\nodejs\\npm.cmd",
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"
    ]);
    expect(resolveNpmLauncher("win32", "C:\\Windows;C:\\Program Files\\nodejs", (f) => files.has(f))).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      prefixArgs: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"]
    });
  });
});

describe("parseAuditJson", () => {
  it("parses npm v7 vulnerabilities", () => {
    const out = parseAuditJson(
      JSON.stringify({
        vulnerabilities: {
          minimist: {
            name: "minimist",
            severity: "high",
            isDirect: true,
            range: "<1.2.6",
            via: [{ title: "Prototype Pollution", url: "https://github.com/advisories/GHSA-xxxx", severity: "high" }]
          }
        }
      })
    );
    expect(out).toEqual([
      {
        id: "minimist",
        severity: "high",
        isDirect: true,
        title: "Prototype Pollution",
        url: "https://github.com/advisories/GHSA-xxxx",
        range: "<1.2.6"
      }
    ]);
  });

  it("falls back to npm v6 advisories", () => {
    const out = parseAuditJson(
      JSON.stringify({
        advisories: {
          "118": { module_name: "lodash", severity: "low", title: "ReDoS", url: "https://x", vulnerable_versions: "<4.17.11" }
        }
      })
    );
    expect(out![0]).toMatchObject({ id: "lodash", severity: "low", title: "ReDoS", isDirect: true });
  });

  it("returns an empty list when there are no vulnerabilities", () => {
    expect(parseAuditJson(JSON.stringify({ vulnerabilities: {} }))).toEqual([]);
  });
});

describe("parseSearchJson", () => {
  it("maps registry search items", () => {
    const out = parseSearchJson(
      JSON.stringify([
        {
          name: "react",
          version: "18.2.0",
          description: "UI library",
          keywords: ["ui"],
          author: { name: "Meta" },
          publisher: { username: "fb" },
          links: { homepage: "https://react.dev" }
        }
      ])
    );
    expect(out![0]).toMatchObject({
      id: "react",
      version: "18.2.0",
      description: "UI library",
      authors: ["Meta"],
      owners: ["fb"],
      tags: ["ui"],
      projectUrl: "https://react.dev",
      source: "npm"
    });
  });
});

describe("parseViewVersionsJson", () => {
  it("parses an array and a single string", () => {
    expect(parseViewVersionsJson(JSON.stringify(["1.0.0", "2.0.0"]))).toEqual(["1.0.0", "2.0.0"]);
    expect(parseViewVersionsJson(JSON.stringify("1.0.0"))).toEqual(["1.0.0"]);
    expect(parseViewVersionsJson("")).toBeNull();
  });
});

describe("parseCliVersion", () => {
  it("strips a leading v and validates", () => {
    expect(parseCliVersion("10.2.4\n")).toBe("10.2.4");
    expect(parseCliVersion("v20.11.0")).toBe("20.11.0");
    expect(parseCliVersion("garbage")).toBeUndefined();
  });
});

describe("compareVersions", () => {
  it("orders by semver rather than publish order", () => {
    const sorted = ["3.0.0", "2.7.0", "3.0.0-beta.2", "3.0.0-beta.10", "10.0.0", "2.6.13"].sort(compareVersions);
    expect(sorted).toEqual(["2.6.13", "2.7.0", "3.0.0-beta.2", "3.0.0-beta.10", "3.0.0", "10.0.0"]);
  });
});
