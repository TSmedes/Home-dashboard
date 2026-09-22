import { useEffect, useState } from "react";
import type { SpotifySnapshot } from "@home-dash/shared";
import { useNow } from "../lib/useNow.js";
import type { WidgetProps } from "./types.js";

type Action = "play" | "pause" | "next" | "previous";

function Icon({ name }: { name: Action }) {
  const paths: Record<Action, string> = {
    play: "M8 5.5v13l10.5-6.5z",
    pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
    next: "M6 6v12l8.5-6zM16 6h2.5v12H16z",
    previous: "M18 6v12l-8.5-6zM5.5 6H8v12H5.5z",
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={paths[name]} fill="currentColor" />
    </svg>
  );
}

const clockOf = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Now playing. The server polls every few seconds; in between, the progress
 * bar is moved on locally from when the reading was taken, so it glides
 * rather than jumping once per poll.
 */
export function SpotifyWidget({ envelope }: WidgetProps<SpotifySnapshot>) {
  const data = envelope?.data;
  const playing = data?.playing ?? false;
  const now = useNow(playing ? 1000 : 60_000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  if (!data) return null;

  if (data.problem === "premium-required") {
    return (
      <div className="widget-message">
        <p>Needs Spotify Premium.</p>
        <p className="widget-message__detail">
          Spotify only serves apps whose owner has Premium. This will start working once the account is upgraded.
        </p>
      </div>
    );
  }
  if (data.problem === "reconnect") {
    return (
      <div className="widget-message">
        <p>Spotify needs connecting again.</p>
        <p className="widget-message__detail">Open Settings and choose Connect Spotify.</p>
      </div>
    );
  }
  if (!data.track) {
    return (
      <div className="widget-message">
        <p>Nothing playing.</p>
      </div>
    );
  }

  const { track } = data;
  const since = envelope?.fetchedAt ? now.getTime() - Date.parse(envelope.fetchedAt) : 0;
  const progress = Math.min(track.durationMs, data.progressMs + (playing ? Math.max(0, since) : 0));
  const premium = data.product === "premium";

  const send = async (action: Action) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/spotify/${action}`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Spotify didn't respond.");
      }
    } catch {
      setError("Can't reach the dashboard server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="spotify" data-playing={playing}>
      <div className="spotify__track">
        {track.artwork ? (
          <img className="spotify__art" src={track.artwork} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="spotify__art spotify__art--empty" aria-hidden="true" />
        )}
        <div className="spotify__text">
          <p className="spotify__title">{track.title}</p>
          <p className="spotify__artist">{track.artist}</p>
          {data.device && <p className="spotify__device">{playing ? "Playing on" : "Paused on"} {data.device}</p>}
        </div>
      </div>

      <div className="spotify__progress">
        <span className="spotify__bar" role="progressbar" aria-valuemin={0} aria-valuemax={track.durationMs} aria-valuenow={progress}>
          <span style={{ width: `${(progress / Math.max(track.durationMs, 1)) * 100}%` }} />
        </span>
        <span className="spotify__times tnum">
          <span>{clockOf(progress)}</span>
          <span>{clockOf(track.durationMs)}</span>
        </span>
      </div>

      {/* Controls are Premium-only on Spotify's side; on a free account they
          would only ever fail, so they are not offered at all. */}
      {premium && (
        <div className="spotify__controls">
          <button type="button" aria-label="Previous track" disabled={busy} onClick={() => void send("previous")}>
            <Icon name="previous" />
          </button>
          <button
            type="button"
            className="spotify__play"
            aria-label={playing ? "Pause" : "Play"}
            disabled={busy}
            onClick={() => void send(playing ? "pause" : "play")}
          >
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <button type="button" aria-label="Next track" disabled={busy} onClick={() => void send("next")}>
            <Icon name="next" />
          </button>
        </div>
      )}
      {error && <p className="spotify__error">{error}</p>}
    </div>
  );
}
