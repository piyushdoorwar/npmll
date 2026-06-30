import { describe, expect, it } from "vitest";
import {
  buildInstallArgs,
  buildOutdatedArgs,
  buildSearchArgs,
  buildUninstallArgs,
  buildViewArgs,
  isTransitiveLocation,
  parseAuditJson,
  parseCliVersion,
  parseOutdatedJson,
  parseSearchJson,
  parseViewVersionsJson
} from "../services/npmCliService";

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

describe("isTransitiveLocation", () => {
  it("detects nested install locations", () => {
    expect(isTransitiveLocation("node_modules/lodash")).toBe(false);
    expect(isTransitiveLocation("node_modules/a/node_modules/b")).toBe(true);
    expect(isTransitiveLocation(undefined)).toBe(false);
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
