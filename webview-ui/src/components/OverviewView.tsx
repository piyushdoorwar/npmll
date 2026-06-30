import { post } from "../api/vscodeApi";
import {
  NpmllSettingsSnapshot,
  OutdatedPackage,
  TabId,
  VulnerablePackage,
  WorkspaceModel
} from "../types";
import { EmptyState } from "./EmptyState";
import { IconCrate, IconHourglass, IconProjectsGrid, IconShieldWarning } from "./Icons";

export function OverviewView(props: {
  model?: WorkspaceModel;
  outdated?: OutdatedPackage[];
  vulnerable?: VulnerablePackage[];
  settings?: NpmllSettingsSnapshot;
  onNavigate: (tab: TabId) => void;
}) {
  const { model } = props;
  if (!model) {
    return <p className="section-hint">Scanning workspace…</p>;
  }
  if (model.projects.length === 0) {
    return (
      <EmptyState
        title="No packages found"
        hint="Open a workspace containing package.json files, then refresh."
        actionLabel="Rescan workspace"
        onAction={() => post({ type: "scanWorkspace" })}
      />
    );
  }

  const uniquePackages = new Set(
    model.projects.flatMap((p) => p.packages.filter((pkg) => !pkg.isTransitive).map((pkg) => pkg.id.toLowerCase()))
  ).size;

  return (
    <div>
      <h2>Overview</h2>
      <p className="section-hint">Workspace scanned {new Date(model.scannedAt).toLocaleTimeString()}.</p>

      {props.settings && !props.settings.npmAvailable && (
        <div className="alert error">
          npm was not found on PATH. Install Node.js to enable package actions.{" "}
          <a href="#install" onClick={() => post({ type: "openExternal", url: "https://nodejs.org/en/download" })}>
            Install instructions ↗
          </a>
        </div>
      )}

      <div className="grid stats">
        <div className="stat-card">
          <div className="stat-body">
            <div>
              <div className="value neutral">{model.projects.length}</div>
              <div className="label">Packages</div>
            </div>
            <div className="stat-icon"><IconProjectsGrid size={20} /></div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-body">
            <div>
              <div className="value">{uniquePackages}</div>
              <div className="label">Dependencies</div>
            </div>
            <div className="stat-icon"><IconCrate size={20} /></div>
          </div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => props.onNavigate("updates")}>
          <div className="stat-body">
            <div>
              <div className={`value ${props.outdated && props.outdated.length > 0 ? "bad" : ""}`}>
                {props.outdated?.length ?? "—"}
              </div>
              <div className="label">Outdated</div>
            </div>
            <div className="stat-icon"><IconHourglass size={20} /></div>
          </div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => props.onNavigate("vulnerabilities")}>
          <div className="stat-body">
            <div>
              <div className={`value ${props.vulnerable && props.vulnerable.length > 0 ? "bad" : ""}`}>
                {props.vulnerable?.length ?? "—"}
              </div>
              <div className="label">Vulnerable</div>
            </div>
            <div className="stat-icon"><IconShieldWarning size={20} /></div>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => props.onNavigate("browse")}>
          Browse packages
        </button>
        <button className="btn btn-secondary" onClick={() => post({ type: "checkOutdated" })}>
          Check updates
        </button>
        <button className="btn btn-secondary" onClick={() => post({ type: "checkVulnerable" })}>
          Check vulnerabilities
        </button>
        <button className="btn btn-ghost" onClick={() => post({ type: "installDependencies" })}>
          Install dependencies
        </button>
      </div>

      <table className="data" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Package</th>
            <th>Version</th>
            <th>Dependencies</th>
            <th>node_modules</th>
            <th style={{ width: 160 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {model.projects.map((project) => (
            <tr key={project.path}>
              <td className="pkg">
                <a href="#open" onClick={() => post({ type: "openFile", path: project.path })}>
                  {project.name}
                </a>
                {project.isWorkspaceRoot && <span className="tag" style={{ marginLeft: 6 }}>root</span>}
              </td>
              <td className="mono">{project.version ?? "—"}</td>
              <td>{project.packages.filter((p) => !p.isTransitive).length}</td>
              <td>
                {project.hasNodeModules ? (
                  <span className="tag">installed</span>
                ) : (
                  <span className="tag">missing</span>
                )}
              </td>
              <td>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => post({ type: "installDependencies", projectPath: project.path })}
                >
                  Install
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
