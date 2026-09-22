import type { LightsSnapshot } from "@home-dash/shared";
import { Dimmer, useLightCommands } from "../LightsWidget.js";
import type { WidgetProps } from "../types.js";

/** White settings, in kelvin. The bulbs report 0 while in colour mode. */
const WHITES = [
  { label: "Warm", kelvin: 2700 },
  { label: "Neutral", kelvin: 4000 },
  { label: "Daylight", kelvin: 6500 },
] as const;

/** Close enough to a preset to call it that; bulbs round what they are sent. */
const near = (a: number, b: number) => Math.abs(a - b) < 300;

/** Every bulb with room to spare: switch, dimmer, the colour of white, and all at once. */
export function LightsDetail({ envelope }: WidgetProps<LightsSnapshot>) {
  const lights = envelope?.data?.lights ?? [];
  const { pending, send } = useLightCommands();
  const reachable = lights.filter((light) => light.reachable);
  const onCount = reachable.filter((light) => pending[light.id]?.on ?? light.on).length;

  if (lights.length === 0) {
    return (
      <div className="widget-message">
        <p>Every bulb is hidden.</p>
        <p className="widget-message__detail">Show them again in Settings.</p>
      </div>
    );
  }

  const all = (on: boolean) => {
    for (const light of reachable) void send(light.id, { on });
  };

  return (
    <div className="detail lightsd">
      <div className="lightsd__bar">
        <p className="lightsd__summary">
          {onCount === 0 ? "Everything is off" : `${onCount} of ${reachable.length} on`}
        </p>
        <div className="lightsd__all">
          <button type="button" className="chip" onClick={() => all(true)} disabled={onCount === reachable.length}>
            All on
          </button>
          <button type="button" className="chip" onClick={() => all(false)} disabled={onCount === 0}>
            All off
          </button>
        </div>
      </div>

      <ul className="lightsd__grid">
        {lights.map((light) => {
          const on = pending[light.id]?.on ?? light.on;
          const brightness = pending[light.id]?.brightness ?? light.brightness;
          const kelvin = pending[light.id]?.colourTemp ?? light.colourTemp;

          return (
            <li className="light lightsd__card" key={light.id} data-on={on} data-reachable={light.reachable}>
              <button
                type="button"
                className="light__toggle"
                onClick={() => void send(light.id, { on: !on })}
                disabled={!light.reachable}
                aria-pressed={on}
              >
                <span className="light__bulb" aria-hidden="true" />
                <span className="light__name">{light.name}</span>
                <span className="lightsd__state">{!light.reachable ? "Not responding" : on ? "On" : "Off"}</span>
              </button>

              {light.reachable && (
                <>
                  <Dimmer
                    value={brightness}
                    disabled={!on}
                    onCommit={(next) => void send(light.id, { brightness: next })}
                  />
                  <div className="lightsd__whites" role="group" aria-label={`${light.name} colour`}>
                    {WHITES.map((white) => (
                      <button
                        key={white.kelvin}
                        type="button"
                        className="chip lightsd__white"
                        data-kelvin={white.kelvin}
                        aria-pressed={kelvin > 0 && near(kelvin, white.kelvin)}
                        disabled={!on}
                        onClick={() => void send(light.id, { colourTemp: white.kelvin })}
                      >
                        {white.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
