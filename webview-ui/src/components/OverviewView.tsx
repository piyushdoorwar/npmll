import { post } from "../api/vscodeApi";
import {
  NpmllSettingsSnapshot,
  OutdatedPackage,
  TabId,
  VulnerablePackage,
  WorkspaceModel,
} from "../types";
import { EmptyState } from "./EmptyState";
import {
  IconCrate,
  IconHourglass,
  IconProjectsGrid,
  IconShieldWarning,
} from "./Icons";

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
    model.projects.flatMap((p) =>
      p.packages
        .filter((pkg) => !pkg.isTransitive)
        .map((pkg) => pkg.id.toLowerCase()),
    ),
  ).size;

  return (
    <div className="overview">
      <div className="page-heading">
        <div>
          <h2>Workspace overview</h2>
          <p className="section-hint">
            Projects, dependencies, and the checks that keep them healthy.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => props.onNavigate("browse")}
        >
          Browse packages <span aria-hidden="true">→</span>
        </button>
      </div>

      {props.settings && !props.settings.npmAvailable && (
        <div className="alert error">
          npm was not found on PATH. Install Node.js to enable package
          actions.{" "}
          <a
            href="#install"
            onClick={() =>
              post({
                type: "openExternal",
                url: "https://nodejs.org/en/download",
              })
            }
          >
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
            <div className="stat-icon">
              <IconProjectsGrid size={20} />
            </div>
          </div>
          <span className="stat-foot">Detected in this workspace</span>
        </div>
        <div className="stat-card">
          <div className="stat-body">
            <div>
              <div className="value">{uniquePackages}</div>
              <div className="label">Dependencies</div>
            </div>
            <div className="stat-icon">
              <IconCrate size={20} />
            </div>
          </div>
          <span className="stat-foot">Unique direct dependencies</span>
        </div>
        <button
          className="stat-card"
          onClick={() => props.onNavigate("updates")}
        >
          <div className="stat-body">
            <div>
              <div
                className={`value ${props.outdated && props.outdated.length > 0 ? "warn" : ""}`}
              >
                {props.outdated?.length ?? "—"}
              </div>
              <div className="label">Outdated</div>
            </div>
            <div className="stat-icon">
              <IconHourglass size={20} />
            </div>
          </div>
          <span className="stat-foot">View available updates →</span>
        </button>
        <button
          className="stat-card"
          onClick={() => props.onNavigate("vulnerabilities")}
        >
          <div className="stat-body">
            <div>
              <div
                className={`value ${props.vulnerable && props.vulnerable.length > 0 ? "bad" : ""}`}
              >
                {props.vulnerable?.length ?? "—"}
              </div>
              <div className="label">Vulnerable</div>
            </div>
            <div className="stat-icon">
              <IconShieldWarning size={20} />
            </div>
          </div>
          <span className="stat-foot">Review security checks →</span>
        </button>
      </div>

      <section className="workspace-checks">
        <div className="panel-heading">
          <div>
            <h3>Keep your workspace healthy</h3>
            <p>Run a check to see what needs attention.</p>
          </div>
        </div>
        <div className="check-grid">
          <button
            className="check-card"
            onClick={() => {
              post({ type: "checkOutdated" });
              props.onNavigate("updates");
            }}
          >
            <IconHourglass size={22} />
            <span>
              <strong>Check for updates</strong>
              <small>Find newer versions across your packages.</small>
            </span>
            <span aria-hidden="true">→</span>
          </button>
          <button
            className="check-card"
            onClick={() => {
              post({ type: "checkVulnerable" });
              props.onNavigate("vulnerabilities");
            }}
          >
            <IconShieldWarning size={22} />
            <span>
              <strong>Check vulnerabilities</strong>
              <small>Review dependencies with known advisories.</small>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
      <section className="workspace-projects">
        <div className="panel-heading">
          <div>
            <h3>
              Packages <span className="tag">{model.projects.length}</span>
            </h3>
            <p>Scanned {new Date(model.scannedAt).toLocaleTimeString()}</p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => post({ type: "installDependencies" })}
          >
            Install dependencies
          </button>
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Workspace packages"
        >
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
                    <a
                      href="#open"
                      onClick={() =>
                        post({ type: "openFile", path: project.path })
                      }
                    >
                      {project.name}
                    </a>
                    {project.isWorkspaceRoot && (
                      <span className="tag" style={{ marginLeft: 6 }}>
                        root
                      </span>
                    )}
                  </td>
                  <td className="mono">{project.version ?? "—"}</td>
                  <td>
                    {project.packages.filter((p) => !p.isTransitive).length}
                  </td>
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
                      onClick={() =>
                        post({
                          type: "installDependencies",
                          projectPath: project.path,
                        })
                      }
                    >
                      Install
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
