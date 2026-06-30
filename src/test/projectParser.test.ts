import { describe, expect, it } from "vitest";
import {
  npmrcToSources,
  parseInstalledVersion,
  parseNpmrc,
  parsePackageJson
} from "../services/projectParser";

const PACKAGE_JSON = JSON.stringify({
  name: "my-app",
  version: "1.2.3",
  dependencies: { react: "^18.2.0", "@scope/util": "1.0.0" },
  devDependencies: { vitest: "^2.0.0" },
  peerDependencies: { typescript: ">=5.0.0" },
  optionalDependencies: { fsevents: "^2.3.0" }
});

describe("parsePackageJson", () => {
  it("extracts name, version and all dependency buckets", () => {
    const parsed = parsePackageJson(PACKAGE_JSON);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("my-app");
    expect(parsed!.version).toBe("1.2.3");
    expect(parsed!.workspaces).toBeUndefined();

    const byType = (type: string) => parsed!.dependencies.filter((d) => d.dependencyType === type).map((d) => d.id);
    expect(byType("dependencies").sort()).toEqual(["@scope/util", "react"]);
    expect(byType("devDependencies")).toEqual(["vitest"]);
    expect(byType("peerDependencies")).toEqual(["typescript"]);
    expect(byType("optionalDependencies")).toEqual(["fsevents"]);

    const react = parsed!.dependencies.find((d) => d.id === "react");
    expect(react).toEqual({ id: "react", version: "^18.2.0", dependencyType: "dependencies" });
  });

  it("normalizes the workspaces array form", () => {
    const parsed = parsePackageJson(JSON.stringify({ name: "root", workspaces: ["packages/*", "apps/*"] }));
    expect(parsed!.workspaces).toEqual(["packages/*", "apps/*"]);
    expect(parsed!.dependencies).toEqual([]);
  });

  it("normalizes the yarn workspaces object form", () => {
    const parsed = parsePackageJson(JSON.stringify({ workspaces: { packages: ["libs/*"] } }));
    expect(parsed!.workspaces).toEqual(["libs/*"]);
  });

  it("returns null for invalid or non-object JSON", () => {
    expect(parsePackageJson("not json")).toBeNull();
    expect(parsePackageJson("[1,2,3]")).toBeNull();
    expect(parsePackageJson("")).toBeNull();
  });

  it("ignores non-string dependency ranges", () => {
    const parsed = parsePackageJson(JSON.stringify({ dependencies: { ok: "1.0.0", bad: 42 } }));
    expect(parsed!.dependencies.map((d) => d.id)).toEqual(["ok"]);
  });
});

describe("parseInstalledVersion", () => {
  it("reads the version field", () => {
    expect(parseInstalledVersion(JSON.stringify({ name: "react", version: "18.2.0" }))).toBe("18.2.0");
  });
  it("returns undefined for invalid JSON or missing version", () => {
    expect(parseInstalledVersion("nope")).toBeUndefined();
    expect(parseInstalledVersion(JSON.stringify({ name: "x" }))).toBeUndefined();
  });
});

describe("parseNpmrc", () => {
  it("parses the default registry, scoped registries and auth hosts", () => {
    const parsed = parseNpmrc(
      [
        "# a comment",
        "registry=https://registry.npmjs.org/",
        "@acme:registry=https://npm.acme.com/",
        "//npm.acme.com/:_authToken=SECRET",
        "//registry.npmjs.org/:_password=base64pw"
      ].join("\n")
    );
    expect(parsed.registries[""]).toBe("https://registry.npmjs.org/");
    expect(parsed.registries["@acme"]).toBe("https://npm.acme.com/");
    expect(parsed.authHosts.sort()).toEqual(["npm.acme.com", "registry.npmjs.org"]);
  });

  it("does not retain token values", () => {
    const parsed = parseNpmrc("//npm.acme.com/:_authToken=super-secret-token");
    expect(JSON.stringify(parsed)).not.toContain("super-secret-token");
  });
});

describe("npmrcToSources", () => {
  it("builds registry sources with scope and credential flags", () => {
    const parsed = parseNpmrc(
      [
        "registry=https://registry.npmjs.org/",
        "@acme:registry=https://npm.acme.com/",
        "//npm.acme.com/:_authToken=SECRET"
      ].join("\n")
    );
    const sources = npmrcToSources([parsed], "/x/.npmrc");
    const def = sources.find((s) => s.name === "npm");
    const acme = sources.find((s) => s.name === "@acme");
    expect(def).toMatchObject({ url: "https://registry.npmjs.org/", enabled: true, hasCredentials: false });
    expect(acme).toMatchObject({ scope: "@acme", url: "https://npm.acme.com/", hasCredentials: true, configPath: "/x/.npmrc" });
  });
});
