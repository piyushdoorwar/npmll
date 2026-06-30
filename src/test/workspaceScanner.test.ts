import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanWorkspaceFolders, WorkspaceScanner } from "../services/workspaceScanner";

const EXCLUDED = ["node_modules", ".git", "dist"];

let root: string;

async function write(relative: string, content: string): Promise<void> {
  const full = path.join(root, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

const pkg = (obj: Record<string, unknown>) => JSON.stringify(obj);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "npmll-test-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("scanWorkspaceFolders", () => {
  it("discovers package.json files and parses dependency buckets", async () => {
    await write(
      "package.json",
      pkg({ name: "app", version: "1.0.0", dependencies: { react: "^18.0.0" }, devDependencies: { vitest: "^2.0.0" } })
    );
    const { model } = await scanWorkspaceFolders([root], EXCLUDED);
    expect(model.projects).toHaveLength(1);
    const app = model.projects[0];
    expect(app.name).toBe("app");
    expect(app.version).toBe("1.0.0");
    expect(app.packages.map((p) => p.id).sort()).toEqual(["react", "vitest"]);
    expect(app.packages.find((p) => p.id === "vitest")?.dependencyType).toBe("devDependencies");
  });

  it("excludes node_modules from the scan", async () => {
    await write("package.json", pkg({ name: "app", dependencies: { lodash: "^4.0.0" } }));
    await write("node_modules/lodash/package.json", pkg({ name: "lodash", version: "4.17.21" }));
    await write("dist/package.json", pkg({ name: "built" }));
    const { model } = await scanWorkspaceFolders([root], EXCLUDED);
    expect(model.projects.map((p) => p.name)).toEqual(["app"]);
  });

  it("resolves installed versions from node_modules and flags missing ones", async () => {
    await write("package.json", pkg({ name: "app", dependencies: { lodash: "^4.0.0", missing: "^1.0.0" } }));
    await write("node_modules/lodash/package.json", pkg({ name: "lodash", version: "4.17.21" }));
    const { model } = await scanWorkspaceFolders([root], EXCLUDED);
    const app = model.projects[0];
    expect(app.hasNodeModules).toBe(true);
    const lodash = app.packages.find((p) => p.id === "lodash");
    const missing = app.packages.find((p) => p.id === "missing");
    expect(lodash).toMatchObject({ resolvedVersion: "4.17.21", isInstalled: true });
    expect(missing).toMatchObject({ resolvedVersion: undefined, isInstalled: false });
  });

  it("treats a package with a workspaces field as a workspace root and finds members", async () => {
    await write("package.json", pkg({ name: "monorepo", workspaces: ["packages/*"] }));
    await write("packages/a/package.json", pkg({ name: "@mono/a", dependencies: { react: "^18.0.0" } }));
    await write("packages/b/package.json", pkg({ name: "@mono/b" }));
    const { model } = await scanWorkspaceFolders([root], EXCLUDED);
    expect(model.projects.map((p) => p.name).sort()).toEqual(["@mono/a", "@mono/b", "monorepo"]);
    expect(model.roots).toHaveLength(1);
    expect(model.projects.find((p) => p.name === "monorepo")?.isWorkspaceRoot).toBe(true);
    expect(model.projects.find((p) => p.name === "@mono/a")?.isWorkspaceRoot).toBe(false);
  });

  it("resolves hoisted dependencies installed at the workspace root", async () => {
    await write("package.json", pkg({ name: "root", workspaces: ["packages/*"] }));
    await write("packages/a/package.json", pkg({ name: "a", dependencies: { react: "^18.0.0" } }));
    await write("node_modules/react/package.json", pkg({ name: "react", version: "18.2.0" }));
    const { model } = await scanWorkspaceFolders([root], EXCLUDED);
    const a = model.projects.find((p) => p.name === "a");
    expect(a?.packages.find((p) => p.id === "react")?.resolvedVersion).toBe("18.2.0");
  });

  it("reads registries from .npmrc and always includes the default registry", async () => {
    await write("package.json", pkg({ name: "app" }));
    await write(".npmrc", "@acme:registry=https://npm.acme.com/\n//npm.acme.com/:_authToken=SECRET\n");
    const { model } = await scanWorkspaceFolders([root], EXCLUDED);
    expect(model.npmrcPaths).toHaveLength(1);
    expect(model.sources.find((s) => s.name === "npm")).toMatchObject({ url: "https://registry.npmjs.org/" });
    expect(model.sources.find((s) => s.scope === "@acme")).toMatchObject({ hasCredentials: true });
  });

  it("reports JSON parse errors as issues", async () => {
    await write("bad/package.json", "{ not valid");
    await write("good/package.json", pkg({ name: "good" }));
    const { model, issues } = await scanWorkspaceFolders([root], EXCLUDED);
    expect(model.projects.map((p) => p.name)).toEqual(["good"]);
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toContain("package.json");
  });

  it("notifies listeners on scan", async () => {
    await write("package.json", pkg({ name: "app" }));
    const scanner = new WorkspaceScanner(() => [root], () => EXCLUDED);
    let notified = false;
    scanner.onDidChangeModel(() => {
      notified = true;
    });
    await scanner.scan();
    expect(notified).toBe(true);
    expect(scanner.getModel()?.projects).toHaveLength(1);
  });
});
