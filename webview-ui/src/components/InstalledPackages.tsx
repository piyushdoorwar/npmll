import { useMemo, useState } from "react";
import { DependencyType, WorkspaceModel } from "../types";
import { EmptyState } from "./EmptyState";
import { IconPackage, IconSearch } from "./Icons";

const DEP_TYPE_LABEL: Record<DependencyType, string> = {
  dependencies: "dep",
  devDependencies: "dev",
  peerDependencies: "peer",
  optionalDependencies: "optional"
};

interface ProjectUse {
  name: string;
  path: string;
  version?: string;
  resolvedVersion?: string;
  isInstalled: boolean;
  dependencyType: DependencyType;
}

interface Row {
  id: string;
  versions: string[];
  dependencyTypes: Set<DependencyType>;
  projects: ProjectUse[];
  transitiveIn: { name: string; path: string }[];
}

export function InstalledPackages(props: {
  model?: WorkspaceModel;
  selectedId?: string;
  onDetails: (packageId: string) => void;
}) {
  const [filter, setFilter] = useState("");

  const rows = useMemo<Row[]>(() => {
    const byId = new Map<string, Row>();
    for (const project of props.model?.projects ?? []) {
      for (const pkg of project.packages) {
        const key = pkg.id.toLowerCase();
        let row = byId.get(key);
        if (!row) {
          row = { id: pkg.id, versions: [], dependencyTypes: new Set(), projects: [], transitiveIn: [] };
          byId.set(key, row);
        }
        if (pkg.isTransitive) {
          if (!row.transitiveIn.some((p) => p.path === project.path)) {
            row.transitiveIn.push({ name: project.name, path: project.path });
          }
        } else {
          const installedVersion = pkg.resolvedVersion ?? pkg.version;
          if (installedVersion && !row.versions.includes(installedVersion)) {
            row.versions.push(installedVersion);
          }
          row.dependencyTypes.add(pkg.dependencyType);
          row.projects.push({
            name: project.name,
            path: project.path,
            version: pkg.version,
            resolvedVersion: pkg.resolvedVersion,
            isInstalled: pkg.isInstalled,
            dependencyType: pkg.dependencyType
          });
        }
      }
    }
    return [...byId.values()]
      .filter((r) => r.projects.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [props.model]);

  const filtered = rows.filter((row) => row.id.toLowerCase().includes(filter.toLowerCase()));

  if (!props.model || props.model.projects.length === 0) {
    return <EmptyState title="No packages found" hint="Open a workspace containing package.json files." />;
  }
  if (rows.length === 0) {
    return <EmptyState icon={<IconPackage size={30} />} title="No packages installed" hint="Use Browse to find and install npm packages." />;
  }

  return (
    <div>
      <h2>Installed packages</h2>
      <p className="section-hint">
        {rows.length} unique package(s) across {props.model.projects.length} workspace package(s). Click a package for details.
      </p>
      <div className="toolbar">
        <div className="search-input-wrap" style={{ maxWidth: 340 }}>
          <span className="search-icon"><IconSearch size={14} /></span>
          <input
            type="text"
            placeholder="Filter installed packages..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button className="search-clear" onClick={() => setFilter("")} title="Clear">
              <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 && (
        <EmptyState icon={<IconPackage size={30} />} title="No matches" hint={`Nothing matched "${filter}".`} />
      )}

      {filtered.map((row) => {
        const notInstalled = row.projects.length > 0 && row.projects.every((p) => !p.isInstalled);
        return (
          <div
            key={row.id}
            className={`pkg-card ${props.selectedId?.toLowerCase() === row.id.toLowerCase() ? "selected" : ""}`}
            onClick={() => props.onDetails(row.id)}
          >
            <div className="pkg-icon">
              <IconPackage size={19} />
            </div>
            <div className="pkg-main">
              <div className="pkg-title">
                <span className="name">{row.id}</span>
                <span className="version">{row.versions.join(", ") || (notInstalled ? "not installed" : "—")}</span>
                {[...row.dependencyTypes].map((t) => (
                  <span key={t} className="tag" title={t}>{DEP_TYPE_LABEL[t]}</span>
                ))}
              </div>
              <div className="pkg-meta">
                {row.projects.map((p) => {
                  const range = p.version ?? "*";
                  const installed = p.isInstalled
                    ? p.resolvedVersion ?? ""
                    : "not installed";
                  return (
                    <span key={p.path} className="tag" title={`${range} → ${installed}`}>
                      {p.name}
                      {!p.isInstalled && " (not installed)"}
                    </span>
                  );
                })}
                {row.transitiveIn.map((p) => (
                  <span key={p.path} className="tag transitive" title="Transitive dependency">{p.name}</span>
                ))}
              </div>
            </div>
          </div>
        );
      })}

    </div>
  );
}
