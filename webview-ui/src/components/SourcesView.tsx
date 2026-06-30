import { post } from "../api/vscodeApi";
import { PackageSource } from "../types";
import { EmptyState } from "./EmptyState";
import { IconGlobe, IconLock } from "./Icons";

export function SourcesView(props: { sources?: PackageSource[] }) {
  return (
    <div>
      <h2>Registries</h2>
      <p className="section-hint">
        Registries are configured through your <code>.npmrc</code> files. This view is read-only —
        edit <code>.npmrc</code> to add, scope, or authenticate a registry.
      </p>

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => post({ type: "openNpmrc" })}>
          Open .npmrc
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {props.sources === undefined && <p className="section-hint">Loading registries…</p>}
        {props.sources !== undefined && props.sources.length === 0 && (
          <EmptyState icon={<IconGlobe size={30} />} title="No registries found" hint="Check your .npmrc configuration." />
        )}
        {props.sources?.map((source) => (
          <div key={source.name} className="card" style={{ marginBottom: 8 }}>
            <div className="source-row">
              <span className={`dot ${source.enabled ? "" : "off"}`} />
              <div className="info">
                <div className="name" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {source.name}
                  {source.scope && <span className="tag" style={{ marginLeft: 4 }}>{source.scope}</span>}
                  {source.hasCredentials && (
                    <span title="Authentication configured" style={{ display: "inline-flex", color: "var(--accent)" }}>
                      <IconLock size={13} />
                    </span>
                  )}
                  {!source.enabled && <span className="tag" style={{ marginLeft: 4 }}>disabled</span>}
                </div>

                <div className="url">{source.url}</div>

                {source.configPath && (
                  <div className="url">
                    config:{" "}
                    <a href="#config" onClick={() => post({ type: "openFile", path: source.configPath! })}>
                      {source.configPath}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
