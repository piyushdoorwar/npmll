# npm LL — guide for Claude Code

VS Code extension that brings a Visual Studio-style package experience to npm/Node.js
projects: workspace scanning, package browse/search/install/update/remove, dependency
health reports, and registry inspection — surfaced through a sidebar and a React
dashboard webview. The `npm` CLI (and `node_modules` filesystem reads) do the package
work; the extension orchestrates it.

## Architecture

Two separately-built halves:

1. **Extension host** (Node, TypeScript) — `src/`, bundled by esbuild to
   `dist/extension.js` (CJS, platform `node`, `vscode` external).
2. **Dashboard webview** (React + Vite) — `webview-ui/`, built to `dist/webview/`
   with **fixed, unhashed filenames** (`index.js`, `index.css`) so the extension can
   reference them via stable URIs. Don't introduce content hashing — see
   `webview-ui/vite.config.ts`.

The two communicate over a typed message protocol in
`src/webview/messageProtocol.ts` (mirrored by `webview-ui/src/types.ts` and
`webview-ui/src/api/vscodeApi.ts`). Keep both sides of the protocol in sync.

### Source layout (`src/`)
- `extension.ts` — activation, command + view registration, file watchers.
- `services/` — the real work. `commandRunner.ts` (spawn wrapper), `npmCliService.ts`
  / `npmApiService.ts` (npm CLI + npm registry HTTP API), `workspaceScanner.ts`,
  `projectParser.ts` (package.json + .npmrc parsing), `packageOperations.ts`,
  `vulnerabilityService.ts`, `packageSourceService.ts`, `container.ts` (DI/wiring).
- `models/` — `workspaceModel`, `projectModel` (a workspace package), `packageModel`,
  `sourceModel` (an npm registry).
- `commands/` — one file per command group; `pickers.ts` for shared quick-pick UI.
- `webview/` — `dashboardPanel.ts` (panel lifecycle + message handling),
  `webviewHtml.ts` (React dashboard HTML shell + CSP/nonce), `homeViewProvider.ts`
  (sidebar launcher; also builds its own CSP/nonce HTML), `messageProtocol.ts`.
- `utils/` — `security.ts` (credential masking), `logger.ts`, `debounce.ts`,
  `pathUtils.ts`.

### Domain model

A "project" is a single **package.json** (the root, or a member of a `workspaces`
monorepo). The workspaces-root package.json plays the role NuGet's `.sln` did. Each
declared dependency is bucketed by **dependency type** (`dependencies`,
`devDependencies`, `peerDependencies`, `optionalDependencies`). The **installed
version** is read from `node_modules/<pkg>/package.json` (walking up to the workspace
root so hoisted installs resolve); a declared-but-absent dependency is flagged
`isInstalled: false`. npm-only for v1 (yarn/pnpm could be added later as sibling CLI
services). There is no central-package-management concept (no `Directory.Packages.props`
analog) and no transitive `packages.config`-style read-only mode.

### Dependency-health checks stream per package

The Updates / Vulnerabilities / Deprecated checks run **one workspace package at a
time** (`dashboardPanel.listTargets()` returns the individual packages so there are
chunks to stream). `vulnerabilityService` takes an `onPartial` callback and the panel
posts incremental `*Results` messages carrying `done` + `progress {completed,total}`;
the webview renders rows as they arrive and shows a "Reviewing N/M packages" banner
(`CheckProgress`). When adding a similar long-running check, follow this shape rather
than awaiting all targets.

- **Outdated** → `npm outdated --json` per package (note: npm exits non-zero when
  packages are outdated — that is not an error). Location depth distinguishes direct
  vs transitive.
- **Vulnerable** → `npm audit --json` per package (handles npm v7 `vulnerabilities`
  and the v6 `advisories` fallback).
- **Deprecated** → there is no batch CLI command, so deprecation is read from
  **registry metadata**: the packument lists a `deprecated` message per version, and
  each installed dependency's resolved version is checked against it. The packument
  is cached, so repeated packages cost a single request — avoid per-package
  `npm view` calls.

The Updates tab prunes a row optimistically when its update succeeds (the host posts
`packageUpdated`; the webview drops the row — no full re-check). Because a streaming
check keeps re-sending its full pre-update result set, `App.tsx` tracks already-updated
rows in `resolvedKeysRef` and filters incoming results against it so an updated row
can't reappear; the set resets on each new check.

## Commands / scripts

| Task | Command |
| --- | --- |
| Build everything | `npm run compile` (esbuild + webview build) |
| Watch extension host | `npm run watch` |
| Build webview only | `npm run webview:build` |
| Webview dev server | `npm run webview:dev` |
| Typecheck (lint) | `npm run lint` (`tsc --noEmit`, no emit) |
| Tests | `npm run test` (Vitest, `src/test/*.test.ts`) |
| Production VSIX prep | `npm run package` |

`postinstall` runs `npm install` inside `webview-ui/`, so a top-level `npm install`
sets up both halves.

## Conventions & guardrails

- **Never run `npm` (or anything) through a shell.** Use `commandRunner` / `spawn`
  with an argument array and an explicit `cwd`. This is a security boundary, not a
  style choice.
- **Mask secrets.** Route any registry URL / token / output that could contain
  credentials through `utils/security.ts` before logging or surfacing it. npm LL reads
  `.npmrc` to learn which registries exist and whether auth is configured, but never
  reads, persists, or logs the token value itself.
- **Confirm before touching shared files.** Editing a workspaces-root package.json is
  a shared-file change and always prompts the user, even from the dashboard. File
  writes stay inside the workspace.
- **Registries are read-only.** npm LL surfaces registries from `.npmrc`; it does not
  add/remove/enable/disable registries or write tokens — edit `.npmrc` directly.
- **Stream health checks per package**, not all-at-once — see above.
- **Exclude `node_modules`** from scanning and from the file watchers (it is always
  excluded; recursing into it would surface every transitive dependency as a package).
- **Keep the message protocol typed and symmetric** across host and webview when
  adding dashboard features.
- **No inline event handlers in webview HTML.** Inline `onclick="…"` attributes are
  blocked by the webview CSP and silently do nothing. Every hand-written webview
  (`webviewHtml.ts`, `homeViewProvider.ts`) must set a CSP with a per-render nonce,
  give its `<script>` that nonce, and wire clicks via a delegated `addEventListener`
  on `data-*` attributes — never inline `onclick`.
- **Webview output filenames are fixed** — don't add hashing or change the
  `dist/webview` layout without updating `webviewHtml.ts`.
- Run `npm run lint` and `npm run test` before considering a change done.

## Branding

The product name is **npm LL** (npm + **L**ibrary **L**ens). Command category and
activity-bar title are both `npm LL`. Command IDs are namespaced `npmll.*`; the config
section and context keys are `npmll`. The logo (`media/npmll.svg`, exported to
`media/npmll.png` at 256×256) is an isometric package cube inside a magnifying-glass
lens, in VS Code blue. Regenerate the PNG from the SVG if the logo changes.
