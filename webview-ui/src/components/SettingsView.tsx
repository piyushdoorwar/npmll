import { post } from "../api/vscodeApi";
import { NpmllSettingsSnapshot } from "../types";
import { IconVsCode } from "./Icons";

const ROWS: { key: keyof NpmllSettingsSnapshot; label: string }[] = [
  { key: "defaultRegistry", label: "Default registry" },
  { key: "includePrerelease", label: "Include prerelease" },
  { key: "showTransitivePackages", label: "Show transitive packages" },
  { key: "confirmBeforeMultiProjectChanges", label: "Confirm multi-package changes" },
  { key: "saveExact", label: "Save exact versions" },
  { key: "preferNpmCli", label: "Prefer npm CLI for search" },
  { key: "registryApiUrl", label: "Registry API URL" },
  { key: "maxSearchResults", label: "Max search results" }
];

export function SettingsView(props: { settings?: NpmllSettingsSnapshot }) {
  return (
    <div>
      <h2>Settings</h2>
      <p className="section-hint">npm LL settings are managed in VS Code settings under the "npmll" namespace.</p>
      <div className="card settings-list">
        {props.settings ? (
          ROWS.map((row) => {
            const value = props.settings![row.key];
            return (
              <div key={row.key} className="meta-row">
                <span className="k">{row.label}</span>
                <span className="v">
                  {typeof value === "boolean" ? (value ? "On" : "Off") : String(value || "—")}
                </span>
              </div>
            );
          })
        ) : (
          <p className="section-hint">Loading settings…</p>
        )}
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-primary" onClick={() => post({ type: "openVsCodeSettings" })}>
            <IconVsCode size={15} />
            Open VS Code settings
          </button>
        </div>
      </div>
    </div>
  );
}
