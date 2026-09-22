import { useCallback, useEffect, useState } from "react";
import { Pager } from "./components/Pager.js";
import { useDashboard } from "./lib/dashboard.js";
import { SettingsPanel } from "./settings/SettingsPanel.js";

function Gear() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="6.2" />
    </svg>
  );
}

export function App() {
  const { config, activeProfile, envelopes, availableSources, connection, fatal } = useDashboard();
  const profile = config && activeProfile ? config.profiles[activeProfile] : undefined;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // The theme belongs to the profile, so day and night can differ completely.
  useEffect(() => {
    document.documentElement.dataset.theme = profile?.theme ?? "light";
  }, [profile?.theme]);

  if (fatal) {
    return (
      <main className="boot">
        <p className="boot__headline">Can&rsquo;t reach the dashboard server.</p>
        <p className="boot__detail">{fatal}</p>
      </main>
    );
  }

  if (!config || !activeProfile) {
    return (
      <main className="boot">
        <p className="boot__headline">Starting up</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="boot">
        <p className="boot__headline">No profile called &ldquo;{activeProfile}&rdquo;.</p>
        <p className="boot__detail">Check the profiles section of config.yaml.</p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <Pager
        key={activeProfile}
        config={config}
        profile={profile}
        envelopes={envelopes}
        availableSources={availableSources}
      />
      {/* The one control added to the dashboard: quiet, but findable. From the
          Home Screen there is no address bar to type /settings into. */}
      <button type="button" className="settings-button" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
        <Gear />
      </button>
      {settingsOpen && <SettingsPanel onClose={closeSettings} />}
      {connection !== "live" && (
        <span
          className="connection"
          title={connection === "offline" ? "Reconnecting to the server" : "Connecting"}
          aria-label="Reconnecting to the server"
        />
      )}
    </main>
  );
}
