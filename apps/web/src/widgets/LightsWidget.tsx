import { type CSSProperties, useState } from "react";
import type { LightsSnapshot } from "@home-dash/shared";
import type { WidgetProps } from "./types.js";

export interface LightCommand {
  on?: boolean;
  brightness?: number;
  colourTemp?: number;
  /** Sent together; the bulb needs both to leave white mode. */
  hue?: number;
  saturation?: number;
}

/**
 * Commands to the bulbs, shared by the tile and its full-screen view. Each
 * command is held locally so a tap registers instantly; the server's reply,
 * which re-reads the bulb, replaces it.
 */
export function useLightCommands() {
  const [pending, setPending] = useState<Record<string, LightCommand>>({});
  // The wall ignores this - the poll corrects the display shortly - but the
  // phone app says why a tap did nothing.
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const send = async (id: string, command: LightCommand) => {
    setPending((prev) => ({ ...prev, [id]: { ...prev[id], ...command } }));
    try {
      const response = await fetch(`/api/lights/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError({ id, message: body.error ?? `the server returned ${response.status}` });
      }
    } catch (cause) {
      setError({ id, message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  return { pending, send, error, clearError: () => setError(null) };
}

export function LightsWidget({ envelope }: WidgetProps<LightsSnapshot>) {
  const lights = envelope?.data?.lights ?? [];
  const { pending, send } = useLightCommands();

  if (lights.length === 0) {
    return (
      <div className="widget-message">
        <p>Every bulb is hidden.</p>
        <p className="widget-message__detail">Show them again in Settings.</p>
      </div>
    );
  }

  return (
    <ul className="lights">
      {lights.map((light) => {
        const on = pending[light.id]?.on ?? light.on;
        const brightness = pending[light.id]?.brightness ?? light.brightness;

        return (
          <li className="light" key={light.id} data-on={on} data-reachable={light.reachable}>
            <button
              type="button"
              className="light__toggle"
              onClick={() => void send(light.id, { on: !on })}
              disabled={!light.reachable}
              aria-pressed={on}
            >
              <span className="light__bulb" aria-hidden="true" />
              <span className="light__name">{light.name}</span>
            </button>

            {light.reachable ? (
              <Dimmer
                value={brightness}
                disabled={!on}
                onCommit={(next) => void send(light.id, { brightness: next })}
              />
            ) : (
              <span className="light__offline">Not responding</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Sends one command when the finger lifts rather than on every pixel of the
 * drag, so sliding the brightness does not fire fifty requests at the bulb.
 */
export function Dimmer({
  value,
  disabled,
  onCommit,
  caption,
}: {
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
  caption?: string;
}) {
  return (
    <CommitSlider
      label="Brightness"
      caption={caption}
      min={1}
      max={100}
      value={value}
      disabled={disabled}
      onCommit={onCommit}
      format={(shown) => `${shown}%`}
    />
  );
}

/** A slider that holds its value while dragged and commits once, on release. */
export function CommitSlider({
  label,
  caption,
  min,
  max,
  step = 1,
  value,
  disabled,
  onCommit,
  format,
  className,
  style,
}: {
  label: string;
  /** Shown above the slider; the tile has no room for it, the full screen does. */
  caption?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
  format: (value: number) => string;
  className?: string;
  /** Custom properties for the track, such as a gradient's ends. */
  style?: Record<`--${string}`, string>;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };

  return (
    <label className={className ? `light__dim ${className}` : "light__dim"} style={style as CSSProperties}>
      {caption && <span className="light__caption">{caption}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, shown))}
        disabled={disabled}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        aria-label={label}
      />
      <span className="light__percent tnum">{format(shown)}</span>
    </label>
  );
}
