import * as vscode from "vscode";
import { NpmllServices } from "../services/container";
import { DashboardPanel } from "./dashboardPanel";

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

/**
 * The single activity-bar view: a small webview launcher that opens the full
 * dashboard. No native tree UI — everything lives in webviews.
 */
export class HomeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "npmll.home";
  private autoOpened = false;
  private view?: vscode.WebviewView;
  private cachedSourceCount: number | "—" = "—";

  constructor(private readonly services: NpmllServices) {
    this.refreshSources();
  }

  private refreshSources(): void {
    this.services.sources.listSources().then((sources) => {
      this.cachedSourceCount = sources.length;
      this.push();
    }).catch(() => {});
  }

  /** Push fresh stats to the sidebar (called after scan / check operations). */
  push(refreshSources = false): void {
    if (!this.view) {
      return;
    }
    if (refreshSources) {
      this.refreshSources();
      return;
    }
    const { projects, packages, outdated, vulnerable, sources, sdk, frameworks, projectList } =
      this.stats();
    this.view.webview.postMessage({
      type: "stats",
      projects,
      packages,
      outdated,
      vulnerable,
      sources,
      sdk,
      frameworks,
      projectList
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage((message: { command: string; tab?: string }) => {
      if (message.command === "open") {
        DashboardPanel.createOrShow(this.services, { tab: message.tab });
      }
      if (message.command === "ready") {
        this.push();
      }
    });

    // Clicking the activity bar icon is the "open npm LL" gesture: surface the
    // dashboard immediately the first time the view becomes visible.
    if (!this.autoOpened) {
      this.autoOpened = true;
      DashboardPanel.createOrShow(this.services);
    }
  }

  private stats() {
    const model = this.services.scanner.getModel();
    const projects = model?.projects.length ?? 0;
    const packages = new Set(
      (model?.projects ?? []).flatMap((p) =>
        p.packages.filter((pkg) => !pkg.isTransitive).map((pkg) => pkg.id)
      )
    ).size;
    const outdated = this.services.results.outdated?.length ?? "—";
    const vulnerable = this.services.results.vulnerable?.length ?? "—";
    const sources = this.cachedSourceCount;
    const node = model?.nodeVersion ?? this.services.npm.nodeVersion ?? null;
    const npm = model?.npmVersion ?? this.services.npm.version ?? null;
    const frameworks = [node ? `node ${node}` : "", npm ? `npm ${npm}` : ""].filter(Boolean);
    const projectList = (model?.projects ?? []).map((p) => ({
      name: p.name,
      pkgCount: p.packages.filter((pkg) => !pkg.isTransitive).length
    }));
    return { projects, packages, outdated, vulnerable, sources, sdk: node, frameworks, projectList };
  }

  private html(webview: vscode.Webview): string {
    const { projects, packages, outdated, vulnerable, sources, sdk, frameworks, projectList } =
      this.stats();
    const scriptNonce = nonce();

    // Brand mark: the npm wordmark box inside a magnifying-glass lens (media/npmll.svg).
    const logoSvg = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g transform="translate(3.9 3.9) scale(0.38)">
        <path d="M0 10V20H9V22H16V20H32V10H0Z" fill="#007acc"/>
        <path d="M5.46205 12H2V18H5.46205V13.6111H7.22344V18H8.98482V12H5.46205ZM10.7462 12V20H14.269V18H17.731V12H10.7462ZM15.9696 16.3889H14.269V13.6111H15.9696V16.3889ZM22.9545 12H19.4924V18H22.9545V13.6111H24.7158V18H26.4772V13.6111H28.2386V18H30V12H22.9545Z" fill="#ffffff"/>
      </g>
      <g stroke="#1f9cf0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <circle cx="10" cy="10" r="8"/>
        <path d="M15.7 15.7 L21 21"/>
      </g>
    </svg>`;

    const frameworksHtml = (items: string[]) =>
      items.length
        ? items.map((f) => `<span class="chip">${f}</span>`).join("")
        : `<span class="chip muted">—</span>`;

    const projectListHtml = (list: { name: string; pkgCount: number }[]) =>
      list.length
        ? list
            .map(
              (p) =>
                `<div class="proj-row" data-open="installed">
                  <span class="proj-name">${p.name}</span>
                  <span class="proj-meta">${p.pkgCount} dep${p.pkgCount !== 1 ? "s" : ""}</span>
                </div>`
            )
            .join("")
        : `<div style="color:#7a7a7a;font-size:11px;padding:6px 0">No package.json found.</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}';" />
<style>
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-thumb { background: #0065a9; border-radius: 99px; }
  ::-webkit-scrollbar-thumb:hover { background: #1f9cf0; }
  body {
    font-family: var(--vscode-font-family);
    color: #f4f4f4;
    background: transparent;
    padding: 16px 12px 24px;
    -webkit-font-smoothing: antialiased;
  }
  .logo {
    width: 46px; height: 46px; border-radius: 13px;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 12px; color: #1f9cf0;
  }
  h2 { margin: 0 0 2px; font-size: 15px; letter-spacing: -0.2px; }
  p { margin: 0 0 16px; color: #b8b8b8; font-size: 12px; }
  button.primary {
    display: flex; align-items: center; justify-content: center;
    gap: 9px; width: 100%;
    background: linear-gradient(180deg, #1f9cf0, #007acc); color: #06243a;
    font-weight: 700; border: none; border-radius: 9px;
    padding: 9px 13px; margin-bottom: 18px;
    font-size: 12.5px; cursor: pointer; font-family: inherit;
    box-shadow: 0 2px 12px rgba(31, 156, 240, 0.25);
    transition: filter 0.15s ease;
  }
  button.primary:hover { filter: brightness(1.07); }
  /* stat cards */
  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
  .card {
    background: #181818; border: 1px solid #262626;
    border-radius: 10px; padding: 12px 13px;
    cursor: pointer; transition: border-color 0.15s ease, transform 0.15s ease;
  }
  .card:hover { border-color: #007acc; transform: translateY(-1px); }
  .card .value { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; color: #1f9cf0; line-height: 1.1; }
  .card .value.neutral { color: #f4f4f4; }
  .card .value.bad { color: #e5534b; }
  .card .label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.7px; color: #7a7a7a; margin-top: 3px; }
  /* section label */
  .sec { font-size: 10px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; color: #5a5a5a; margin: 18px 0 8px; }
  /* workspace info */
  .info-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .info-key { font-size: 11.5px; color: #7a7a7a; }
  .sdk-badge {
    font-family: "SF Mono", Consolas, monospace; font-size: 11px;
    background: rgba(31,156,240,0.1); color: #1f9cf0;
    border: 1px solid rgba(31,156,240,0.25); border-radius: 99px;
    padding: 2px 9px;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    background: #1e1e1e; border: 1px solid #2a2a2a;
    border-radius: 99px; padding: 2px 9px;
    font-size: 10.5px; color: #a0a0a0;
    font-family: "SF Mono", Consolas, monospace;
  }
  .chip.muted { color: #5a5a5a; }
  /* projects list */
  .proj-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 10px; border-radius: 7px; cursor: pointer;
    transition: background 0.12s;
  }
  .proj-row:hover { background: #1e1e1e; }
  .proj-name { font-size: 12px; color: #d0d0d0; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .proj-meta { font-size: 10.5px; color: #5a5a5a; flex-shrink: 0; margin-left: 8px; }
</style>
</head>
<body>
  <div class="logo">${logoSvg}</div>
  <h2>npm LL</h2>
  <p>npm package management and Library Lens.</p>
  <button class="primary" data-open="overview">Open Dashboard</button>

  <div class="cards">
    <div class="card" data-open="overview">
      <div class="value neutral" id="val-projects">${projects}</div>
      <div class="label">Packages</div>
    </div>
    <div class="card" data-open="installed">
      <div class="value" id="val-packages">${packages}</div>
      <div class="label">Dependencies</div>
    </div>
    <div class="card" data-open="updates">
      <div class="value${typeof outdated === "number" && outdated > 0 ? " bad" : ""}" id="val-outdated">${outdated}</div>
      <div class="label">Outdated</div>
    </div>
    <div class="card" data-open="vulnerabilities">
      <div class="value${typeof vulnerable === "number" && vulnerable > 0 ? " bad" : ""}" id="val-vulnerable">${vulnerable}</div>
      <div class="label">Vulnerable</div>
    </div>
    <div class="card" data-open="sources">
      <div class="value neutral" id="val-sources">${sources}</div>
      <div class="label">Registries</div>
    </div>
  </div>

  <div class="sec">Workspace</div>
  <div class="info-row">
    <span class="info-key">Runtime</span>
    <span class="sdk-badge" id="val-sdk">${sdk ? `node ${sdk}` : "—"}</span>
  </div>
  <div class="chips" id="val-frameworks">${frameworksHtml(frameworks)}</div>

  <div class="sec">Packages</div>
  <div id="val-project-list">${projectListHtml(projectList)}</div>

  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    function open_(tab) { vscode.postMessage({ command: "open", tab }); }
    // Event delegation: inline onclick handlers are blocked by the webview CSP,
    // so route every [data-open] element through a single listener instead.
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-open]");
      if (el) open_(el.getAttribute("data-open"));
    });
    vscode.postMessage({ command: "ready" });
    window.addEventListener("message", (e) => {
      const m = e.data;
      if (m.type !== "stats") return;
      set("val-projects", m.projects, false);
      set("val-packages", m.packages, false);
      set("val-outdated", m.outdated, true);
      set("val-vulnerable", m.vulnerable, true);
      set("val-sources", m.sources, false);
      const sdkEl = document.getElementById("val-sdk");
      if (sdkEl) sdkEl.textContent = m.sdk ? "node " + m.sdk : "—";
      const fwEl = document.getElementById("val-frameworks");
      if (fwEl) fwEl.innerHTML = m.frameworks.length
        ? m.frameworks.map(f => '<span class="chip">' + f + '</span>').join("")
        : '<span class="chip muted">—</span>';
      const plEl = document.getElementById("val-project-list");
      if (plEl) plEl.innerHTML = m.projectList.length
        ? m.projectList.map(p => '<div class="proj-row" data-open="installed">' +
            '<span class="proj-name">' + p.name + '</span>' +
            '<span class="proj-meta">' + p.pkgCount + ' dep' + (p.pkgCount !== 1 ? 's' : '') + '</span></div>').join("")
        : '<div style="color:#7a7a7a;font-size:11px;padding:6px 0">No package.json found.</div>';
    });
    function set(id, val, bad) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = String(val);
      el.className = "value" + (bad && typeof val === "number" && val > 0 ? " bad" : !bad ? " neutral" : "");
    }
  </script>
</body>
</html>`;
  }
}
