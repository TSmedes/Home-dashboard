import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ConfigChange, DashboardConfig } from "@home-dash/shared";
import { pagesOf } from "../components/pages.js";
import { send } from "../lib/api.js";
import { useEdit } from "../edit/EditContext.js";
import { useDashboard } from "../lib/dashboard.js";
import { useNow } from "../lib/useNow.js";
import { WIDGET_NAMES } from "../widgets/names.js";
import { CommitInput, Segmented, Switch } from "./controls.js";
import { ago, overrideSummary, profileLabel, scheduleChanges } from "./model.js";
import { Row, Section } from "./parts.js";
import { PlaceSearch } from "./PlaceSearch.js";

/** Settings closes itself after this long untouched, so the wall never stays on it. */
const IDLE_CLOSE_MS = 120_000;

const SOURCE_NAMES: Record<string, string> = {
  weather: "Weather",
  calendar: "Calendar",
  tasks: "TickTick",
  lights: "Lights",
  river: "River gauge",
  countdowns: "Countdowns",
  commute: "TomTom",
  spotify: "Spotify",
  system: "Server stats",
  services: "Services",
};

type Notice = { text: string; tone: "ok" | "error" } | null;
type Save = (changes: ConfigChange[], done?: string) => Promise<void>;

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { config, activeProfile, override, connection } = useDashboard();
  const panel = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // Any touch, key or scroll inside settings restarts the idle countdown.
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    let timer = window.setTimeout(onClose, IDLE_CLOSE_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onClose, IDLE_CLOSE_MS);
    };
    const events = ["pointerdown", "keydown", "input", "scroll"] as const;
    for (const type of events) element.addEventListener(type, reset, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const type of events) element.removeEventListener(type, reset, { capture: true });
    };
  }, [onClose]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.tone === "error" ? 6000 : 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const save: Save = useCallback(async (changes, done = "Saved") => {
    if (changes.length === 0) return;
    try {
      await send("PATCH", "/api/config", { changes });
      setNotice({ text: done, tone: "ok" });
    } catch (cause) {
      setNotice({ text: `Not saved: ${cause instanceof Error ? cause.message : String(cause)}`, tone: "error" });
      throw cause;
    }
  }, []);

  if (!config || !activeProfile) return null;

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={panel}>
      <header className="settings__bar">
        <h1 className="settings__title" id="settings-title">
          Settings
        </h1>
        <p className="settings__notice" role="status" data-tone={notice?.tone}>
          {notice?.text}
        </p>
        <button type="button" className="button button--primary" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="settings__scroll">
        <div className="settings__column">
          <ProfileSection config={config} active={activeProfile} override={override} setNotice={setNotice} />
          <ScheduleSection config={config} save={save} setNotice={setNotice} />
          <LocationSection config={config} save={save} />
          {config.lights.length > 0 && <LightsSection config={config} save={save} />}
          <WidgetsSection config={config} active={activeProfile} save={save} onClose={onClose} />
          <SpotifySection setNotice={setNotice} />
          <StatusSection connection={connection} />
        </div>
      </div>
    </div>
  );
}

function ProfileSection({
  config,
  active,
  override,
  setNotice,
}: {
  config: DashboardConfig;
  active: string;
  override: ReturnType<typeof useDashboard>["override"];
  setNotice: (notice: Notice) => void;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);

  const act = async (method: "POST" | "DELETE", body?: unknown) => {
    setBusy(true);
    try {
      await send(method, "/api/profile/override", body);
    } catch (cause) {
      setNotice({ text: `Couldn't switch: ${cause instanceof Error ? cause.message : String(cause)}`, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Night mode">
      <div className="settings__lead">
        <p>{overrideSummary(override, active, now, config.location.timezone, config.units.clock)}</p>
        <div className="settings__actions">
          {override ? (
            <button type="button" className="button button--primary" disabled={busy} onClick={() => act("DELETE")}>
              Back to schedule
            </button>
          ) : (
            Object.keys(config.profiles)
              .filter((profile) => profile !== active)
              .map((profile) => (
                <button
                  key={profile}
                  type="button"
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => act("POST", { profile })}
                >
                  Switch to {profile}
                </button>
              ))
          )}
        </div>
      </div>
    </Section>
  );
}

function ScheduleSection({
  config,
  save,
  setNotice,
}: {
  config: DashboardConfig;
  save: Save;
  setNotice: (notice: Notice) => void;
}) {
  return (
    <Section title="Schedule and display">
      {Object.entries(config.profiles).map(([name, profile]) => (
        <Row key={name} label={`${profileLabel(name)} starts`}>
          <CommitInput
            type="time"
            label={`${profileLabel(name)} starts at`}
            value={profile.schedule.from}
            onCommit={(from) => {
              try {
                void save(scheduleChanges(config.profiles, name, from)).catch(() => {});
              } catch (cause) {
                setNotice({ text: cause instanceof Error ? cause.message : String(cause), tone: "error" });
              }
            }}
          />
        </Row>
      ))}
      <Row label="Clock">
        <Segmented
          label="Clock"
          value={config.units.clock}
          options={[
            { value: "12h", label: "12-hour" },
            { value: "24h", label: "24-hour" },
          ]}
          onChange={(clock) => void save([{ path: ["units", "clock"], value: clock }]).catch(() => {})}
        />
      </Row>
      <Row label="Temperature">
        <Segmented
          label="Temperature"
          value={config.units.temperature}
          options={[
            { value: "fahrenheit", label: "°F" },
            { value: "celsius", label: "°C" },
          ]}
          onChange={(temperature) =>
            void save([{ path: ["units", "temperature"], value: temperature }]).catch(() => {})
          }
        />
      </Row>
    </Section>
  );
}

function LocationSection({ config, save }: { config: DashboardConfig; save: Save }) {
  return (
    <Section title="Location">
      <div className="settings__lead">
        <p>
          Weather and times are for <strong>{config.location.name}</strong>.
        </p>
      </div>
      <PlaceSearch
        label="Search for a town"
        onPick={(place) =>
          void save(
            [
              { path: ["location", "name"], value: place.label },
              { path: ["location", "lat"], value: place.lat },
              { path: ["location", "lon"], value: place.lon },
              { path: ["location", "timezone"], value: place.timezone },
            ],
            `Location set to ${place.label}`,
          ).catch(() => {})
        }
      />
    </Section>
  );
}

function LightsSection({ config, save }: { config: DashboardConfig; save: Save }) {
  return (
    <Section title="Lights">
      {config.lights.map((light) => (
        <div className="settings__row" key={light.id}>
          <span className="settings__grow">
            <CommitInput
              label={`Name for the bulb at ${light.host}`}
              value={light.name}
              onCommit={(name) =>
                void save([{ path: ["lights", { id: light.id }, "name"], value: name }], `Renamed to ${name}`).catch(
                  () => {},
                )
              }
            />
            <span className="settings__detail">{light.host}</span>
          </span>
          <span className="settings__control settings__control--labelled">
            <span className="settings__detail">Show</span>
            <Switch
              checked={!light.hidden}
              label={`Show ${light.name} on the dashboard`}
              // Showing is the default, so it removes the key rather than writing hidden: false.
              onChange={(show) => save([{ path: ["lights", { id: light.id }, "hidden"], value: show ? null : true }])}
            />
          </span>
        </div>
      ))}
    </Section>
  );
}

function WidgetsSection({
  config,
  active,
  save,
  onClose,
}: {
  config: DashboardConfig;
  active: string;
  save: Save;
  onClose: () => void;
}) {
  const names = Object.keys(config.profiles);
  const [profile, setProfile] = useState(names.includes(active) ? active : names[0]!);
  const edit = useEdit();
  const widgets = config.profiles[profile]?.widgets ?? [];
  const pages = pagesOf(widgets);

  return (
    <Section title="Widgets">
      {names.length > 1 && (
        <div className="settings__lead">
          <Segmented
            label="Which screen"
            value={profile}
            options={names.map((name) => ({ value: name, label: `${profileLabel(name)} screen` }))}
            onChange={setProfile}
          />
        </div>
      )}
      <Row label="Layout" detail="Move, resize, add and remove widgets on the screen itself.">
        <button
          type="button"
          className="button"
          onClick={() => {
            edit.begin(profile);
            onClose();
          }}
        >
          Edit layout
        </button>
      </Row>
      {pages.map((page, index) => (
        <div key={page.number} className="settings__group">
          {pages.length > 1 && <p className="settings__subhead">Page {index + 1}</p>}
          {page.widgets.map((widget) => {
            const name = widget.title ?? WIDGET_NAMES[widget.type] ?? widget.type;
            return (
              <Row key={widget.id} label={name}>
                <Switch
                  checked={widget.enabled}
                  label={`Show ${name} on the ${profile} screen`}
                  onChange={(enabled) =>
                    save([
                      // On is the default, so switching back on removes the key.
                      { path: ["profiles", profile, "widgets", { id: widget.id }, "enabled"], value: enabled ? null : false },
                    ])
                  }
                />
              </Row>
            );
          })}
        </div>
      ))}
      <p className="settings__empty">
        {widgets.some((w) => w.grid.share)
          ? "Widgets in a shared row split its width, so switching one off widens the others. Anywhere else, a switched-off widget leaves its space empty."
          : "A switched-off widget leaves its space empty; switching it back puts it where it was."}
      </p>
    </Section>
  );
}

interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  redirectUri: string;
}

/**
 * Connecting Spotify. Spotify sends the browser back to a loopback address
 * nothing listens on, so the last step is copying that address back here -
 * the one bit of sign-in that has to be done by hand.
 */
function SpotifySection({ setNotice }: { setNotice: (notice: Notice) => void }) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [started, setStarted] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    send("GET", "/api/spotify")
      .then((body) => setStatus(body as SpotifyStatus))
      .catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);

  if (!status?.configured) return null;

  const connect = async () => {
    setError(null);
    try {
      const { url } = (await send("POST", "/api/spotify/connect")) as { url: string };
      window.open(url, "_blank", "noopener");
      setStarted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send("POST", "/api/spotify/callback", { pasted });
      setNotice({ text: "Spotify connected", tone: "ok" });
      setStarted(false);
      setPasted("");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await send("DELETE", "/api/spotify").catch(() => {});
    setNotice({ text: "Spotify disconnected", tone: "ok" });
    load();
  };

  return (
    <Section title="Spotify">
      {status.connected ? (
        <Row label="Connected">
          <button type="button" className="button" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </Row>
      ) : (
        <div className="settings__lead">
          {!started ? (
            <>
              <p>Sign in to Spotify to show what&rsquo;s playing.</p>
              <button type="button" className="button button--primary" onClick={() => void connect()}>
                Connect Spotify
              </button>
            </>
          ) : (
            <form className="settings__connect" onSubmit={finish}>
              <p>
                After you agree, the browser lands on a page that won&rsquo;t load, at an address beginning{" "}
                <strong>{status.redirectUri}</strong>. Copy that whole address and paste it here.
              </p>
              <input
                className="field"
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder={`${status.redirectUri}?code=…`}
                aria-label="The address Spotify sent you to"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button type="submit" className="button button--primary" disabled={busy || pasted.trim().length === 0}>
                {busy ? "Connecting" : "Finish"}
              </button>
            </form>
          )}
          {error && <p className="settings__error">{error}</p>}
        </div>
      )}
    </Section>
  );
}

interface Health {
  sources: { key: string; stale: boolean; fetchedAt: string | null; error: string | null }[];
}

function StatusSection({ connection }: { connection: ReturnType<typeof useDashboard>["connection"] }) {
  const now = useNow(5_000);
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      send("GET", "/api/health")
        .then((body) => !cancelled && (setHealth(body as Health), setFailed(false)))
        .catch(() => !cancelled && setFailed(true));
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Section title="Status">
      <Row label="This screen">
        <span className="status" data-ok={connection === "live"}>
          {connection === "live" ? "Connected" : "Reconnecting"}
        </span>
      </Row>
      {failed && <p className="settings__error">Couldn't reach the server for its status.</p>}
      {health?.sources.map((source) => (
        <Row
          key={source.key}
          label={SOURCE_NAMES[source.key] ?? source.key}
          {...(source.error ? { detail: source.error } : {})}
        >
          <span className="status" data-ok={!source.stale}>
            {source.error
              ? "Update failed"
              : source.fetchedAt
                ? `Updated ${ago(source.fetchedAt, now)}`
                : "Waiting for first update"}
          </span>
        </Row>
      ))}
    </Section>
  );
}
