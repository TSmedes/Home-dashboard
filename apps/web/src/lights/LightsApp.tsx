import { useCallback, useEffect, useState } from "react";
import type { ConfigChange, LightsSnapshot, WidgetEnvelope } from "@home-dash/shared";
import { reason, send as sendToServer } from "../lib/api.js";
import { useDashboard } from "../lib/dashboard.js";
import { LightCard } from "../widgets/detail/LightsDetail.js";
import { useLightCommands } from "../widgets/LightsWidget.js";
import { ManageLights } from "./ManageLights.js";

type Tab = "control" | "manage";
export type Notice = { text: string; tone: "ok" | "error" };
export type Save = (changes: ConfigChange[], done?: string) => Promise<void>;

/** The phone app: every bulb, and the bulbs themselves - names, visibility, order. */
export function LightsApp() {
  const { config, envelopes, connection, fatal } = useDashboard();
  const [tab, setTab] = useState<Tab>("control");
  const [notice, setNotice] = useState<Notice | null>(null);
  const commands = useLightCommands();
  const envelope = envelopes["lights"] as WidgetEnvelope<LightsSnapshot> | undefined;
  const lights = envelope?.data?.lights ?? [];
  const names = new Map(lights.map((light) => [light.id, light.name]));

  // A command the bulb refused says so, by name, rather than silently snapping back.
  const { error, clearError } = commands;
  useEffect(() => {
    if (!error) return;
    setNotice({ text: `${names.get(error.id) ?? error.id}: ${error.message}`, tone: "error" });
    clearError();
  }, [error]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.tone === "error" ? 6000 : 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const save: Save = useCallback(async (changes, done = "Saved") => {
    if (changes.length === 0) return;
    try {
      await sendToServer("PATCH", "/api/config", { changes });
      setNotice({ text: done, tone: "ok" });
    } catch (cause) {
      setNotice({ text: `Not saved: ${reason(cause)}`, tone: "error" });
      throw cause;
    }
  }, []);

  if (fatal) {
    return (
      <main className="boot">
        <p className="boot__headline">Can&rsquo;t reach the home server.</p>
        <p className="boot__detail">{fatal}</p>
      </main>
    );
  }

  if (!config) {
    return (
      <main className="boot">
        <p className="boot__headline">Starting up</p>
      </main>
    );
  }

  const reachable = lights.filter((light) => light.reachable);
  const onCount = reachable.filter((light) => commands.pending[light.id]?.on ?? light.on).length;
  const all = (on: boolean) => {
    for (const light of reachable) void commands.send(light.id, { on });
  };

  return (
    <div className="lapp">
      <header className="lapp__header">
        <div className="lapp__titlebar">
          <a className="lapp__home" href="/?choose" aria-label="Choose an app">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11.5 12 5l8 6.5M6.5 10v9h11v-9" />
            </svg>
          </a>
          <h1 className="lapp__title">Lights</h1>
          {connection !== "live" && (
            <span className="lapp__connection" role="status">
              {connection === "offline" ? "Reconnecting" : "Connecting"}
            </span>
          )}
        </div>

        <div className="segmented lapp__tabs" role="radiogroup" aria-label="View">
          {(["control", "manage"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              className="segmented__option"
              aria-checked={tab === option}
              onClick={() => setTab(option)}
            >
              {option === "control" ? "Control" : "Manage"}
            </button>
          ))}
        </div>
      </header>

      <main className="lapp__body">
        {tab === "control" ? (
          config.lights.length === 0 ? (
            <Empty headline="No lights yet." detail="Add your bulbs under lights: in config.yaml, or run npm run setup." />
          ) : !envelope ? (
            <Empty headline="Finding your bulbs" />
          ) : lights.length === 0 ? (
            <Empty
              headline={envelope.error ? "Couldn’t read the bulbs." : "Every bulb is hidden."}
              detail={envelope.error?.message ?? "Show them again under Manage."}
            />
          ) : (
            <>
              <div className="lapp__bar">
                <p className="lapp__summary">
                  {onCount === 0 ? "Everything is off" : `${onCount} of ${reachable.length} on`}
                </p>
                <div className="lapp__all">
                  <button type="button" className="chip" onClick={() => all(true)} disabled={onCount === reachable.length}>
                    All on
                  </button>
                  <button type="button" className="chip" onClick={() => all(false)} disabled={onCount === 0}>
                    All off
                  </button>
                </div>
              </div>
              <ul className="lightsd__grid lapp__grid">
                {lights.map((light) => (
                  <LightCard key={light.id} light={light} pending={commands.pending[light.id]} send={commands.send} />
                ))}
              </ul>
            </>
          )
        ) : (
          <ManageLights lights={config.lights} save={save} />
        )}
      </main>

      {notice && (
        <p className="lapp__notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
    </div>
  );
}

function Empty({ headline, detail }: { headline: string; detail?: string }) {
  return (
    <div className="lapp__empty">
      <p className="boot__headline">{headline}</p>
      {detail && <p className="boot__detail">{detail}</p>}
    </div>
  );
}
