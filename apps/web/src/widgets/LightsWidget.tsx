import { useState } from "react";
import type { LightsSnapshot } from "@home-dash/shared";
import type { WidgetProps } from "./types.js";

export interface LightCommand {
  on?: boolean;
  brightness?: number;
  colourTemp?: number;
}

/**
 * Commands to the bulbs, shared by the tile and its full-screen view. Each
 * command is held locally so a tap registers instantly; the server's reply,
 * which re-reads the bulb, replaces it.
 */
export function useLightCommands() {
  const [pending, setPending] = useState<Record<string, LightCommand>>({});

  const send = async (id: string, command: LightCommand) => {
    setPending((prev) => ({ ...prev, [id]: { ...prev[id], ...command } }));
    try {
      await fetch(`/api/lights/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
    } catch {
      // The poll will correct the display shortly; nothing useful to say here.
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  return { pending, send };
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
}: {
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };

  return (
    <label className="light__dim">
      <input
        type="range"
        min={1}
        max={100}
        value={shown}
        disabled={disabled}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        aria-label="Brightness"
      />
      <span className="light__percent tnum">{shown}%</span>
    </label>
  );
}
