# Changelog

All notable changes to the npm LL extension are documented in this file.

## [0.1.0] - 2026-06-30

### Added

- Initial release.
- Workspace scanner for `package.json` (root and `workspaces` monorepo members) and `.npmrc`, always excluding `node_modules`.
- Activity bar sidebar with at-a-glance counts (packages, dependencies, outdated, vulnerable, registries) and a per-package launcher.
- Dark, blue-accented webview dashboard with Overview, Browse, Installed, Updates, Vulnerabilities, Registries, and Settings tabs.
- Package search via the npm registry HTTP API with an `npm search` fallback.
- Dependency-type awareness (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`) on display and install.
- Installed-vs-declared version resolution from `node_modules` (with hoisting), flagging declared-but-absent dependencies.
- Install, update, and remove packages in one or multiple workspace packages.
- Outdated (`npm outdated`), vulnerable (`npm audit`), and deprecated (registry metadata) reports, streamed one package at a time.
- Read-only registry inspector backed by `.npmrc`, with quick access to edit `.npmrc`.
- Install-dependencies commands (`npm install`) for the workspace or a single package.
- File watchers with debounced refresh (ignoring `node_modules`).
- Secret masking in logs and shell-injection-safe command execution.
