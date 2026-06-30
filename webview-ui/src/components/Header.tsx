import { NpmllSettingsSnapshot } from "../types";
import { IconLogo, IconRefresh } from "./Icons";

export function Header(props: {
  settings?: NpmllSettingsSnapshot;
  projectCount: number;
  onRefresh: () => void;
}) {
  const { settings, projectCount, onRefresh } = props;
  return (
    <header className="header">
      <div className="logo">
        <IconLogo size={24} stroke="#1f9cf0" />
      </div>
      <div>
        <h1>npm LL</h1>
        <p className="subtitle">Visual npm package management for VS Code workspaces.</p>
      </div>
      <div className="spacer" />
      <span className="badge">
        {projectCount} package{projectCount === 1 ? "" : "s"}
      </span>
      {settings &&
        (settings.npmAvailable ? (
          <span className="badge ok">npm {settings.npmVersion ?? "?"}</span>
        ) : (
          <span className="badge error">npm not found</span>
        ))}
      <button className="btn btn-ghost btn-sm" onClick={onRefresh}>
        <IconRefresh size={14} />
        Refresh
      </button>
    </header>
  );
}
