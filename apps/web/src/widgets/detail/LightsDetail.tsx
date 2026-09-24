import { type CSSProperties, useState } from "react";
import type { LightState, LightsSnapshot } from "@home-dash/shared";
import { CommitSlider, Dimmer, type LightCommand, useLightCommands } from "../LightsWidget.js";
import type { WidgetProps } from "../types.js";

/** White settings, in kelvin. The bulbs report 0 while in colour mode. */
const WHITES = [
  { label: "Warm", kelvin: 2700 },
  { label: "Neutral", kelvin: 4000 },
  { label: "Daylight", kelvin: 6500 },
] as const;

/** One tap to a colour; the sliders are there for anything in between. */
const COLOURS = [
  { label: "Red", hue: 0 },
  { label: "Orange", hue: 30 },
  { label: "Yellow", hue: 55 },
  { label: "Green", hue: 120 },
  { label: "Teal", hue: 180 },
  { label: "Blue", hue: 230 },
  { label: "Purple", hue: 275 },
  { label: "Pink", hue: 320 },
] as const;

/** For bulbs from a server that does not say; the narrower of the two ranges we know. */
const DEFAULT_MIN_KELVIN = 2500;
const DEFAULT_MAX_KELVIN = 6500;

/** Close enough to a preset to call it that; bulbs round what they are sent. */
const near = (a: number, b: number) => Math.abs(a - b) < 300;
const nearHue = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) < 12;

/**
 * Roughly the colour a white of this temperature looks, for the swatch and the
 * warmth slider's track. Tanner Helland's fit to the black-body curve: good
 * enough to tell warm from cool at a glance, which is all it is for.
 */
export function kelvinToCss(kelvin: number): string {
  const t = kelvin / 100;
  const clamp = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return `rgb(${clamp(r)} ${clamp(g)} ${clamp(b)})`;
}

/** A bulb's colour as the eye would see it; lightness eases toward white as saturation drops. */
export const hueToCss = (hue: number, saturation: number) => `hsl(${hue} ${saturation}% ${100 - saturation / 2}%)`;

type Mode = "white" | "colour";

/** Every bulb with room to spare: switch, dimmer, whites and colours, and all at once. */
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
        {lights.map((light) => (
          <LightCard key={light.id} light={light} pending={pending[light.id]} send={send} />
        ))}
      </ul>
    </div>
  );
}

export function LightCard({
  light,
  pending,
  send,
}: {
  light: LightState;
  pending: LightCommand | undefined;
  send: (id: string, command: LightCommand) => Promise<void>;
}) {
  const on = pending?.on ?? light.on;
  const brightness = pending?.brightness ?? light.brightness;
  const hue = pending?.hue ?? light.hue;
  const saturation = pending?.saturation ?? light.saturation;
  // A colour just sent means colour mode, whatever the last poll said.
  const kelvin = pending?.hue !== undefined ? 0 : (pending?.colourTemp ?? light.colourTemp);
  const minKelvin = light.minKelvin ?? DEFAULT_MIN_KELVIN;
  const maxKelvin = light.maxKelvin ?? DEFAULT_MAX_KELVIN;

  // Which controls are showing is the viewer's choice; it only follows the
  // bulb until they pick. Nothing is sent until they choose a white or colour.
  const [chosen, setChosen] = useState<Mode | null>(null);
  const mode: Mode = chosen ?? (kelvin === 0 ? "colour" : "white");

  const glow = !on ? undefined : kelvin === 0 ? hueToCss(hue, saturation) : kelvinToCss(kelvin);
  const colour = (next: { hue?: number; saturation?: number }) =>
    void send(light.id, { hue: next.hue ?? hue, saturation: next.saturation ?? (saturation || 100) });

  return (
    <li
      className="light lightsd__card"
      data-on={on}
      data-reachable={light.reachable}
      style={glow ? ({ "--glow": glow } as CSSProperties) : undefined}
    >
      <button
        type="button"
        className="light__toggle"
        onClick={() => void send(light.id, { on: !on })}
        disabled={!light.reachable}
        aria-pressed={on}
      >
        <span className="lightsd__glow" aria-hidden="true" />
        <span className="light__bulb" aria-hidden="true" />
        <span className="light__name">{light.name}</span>
        <span className="lightsd__state">{!light.reachable ? "Not responding" : on ? "On" : "Off"}</span>
      </button>

      {light.reachable && (
        <>
          <Dimmer
            caption="Brightness"
            value={brightness}
            disabled={!on}
            onCommit={(next) => void send(light.id, { brightness: next })}
          />

          <div className="segmented lightsd__modes" role="radiogroup" aria-label={`${light.name}: white or colour`}>
            {(["white", "colour"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                className="segmented__option"
                aria-checked={mode === option}
                disabled={!on}
                onClick={() => setChosen(option)}
              >
                {option === "white" ? "White" : "Colour"}
              </button>
            ))}
          </div>

          {mode === "white" ? (
            <>
              <CommitSlider
                label={`${light.name} warmth`}
                caption="Warmth"
                className="lightsd__slider lightsd__slider--warmth"
                min={minKelvin}
                max={maxKelvin}
                step={50}
                value={kelvin || minKelvin}
                disabled={!on}
                onCommit={(next) => void send(light.id, { colourTemp: next })}
                format={(shown) => `${shown}K`}
                style={{ "--from": kelvinToCss(minKelvin), "--to": kelvinToCss(maxKelvin) }}
              />
              <div className="lightsd__whites" role="group" aria-label={`${light.name} white presets`}>
                {WHITES.filter((white) => white.kelvin >= minKelvin && white.kelvin <= maxKelvin).map((white) => (
                  <button
                    key={white.kelvin}
                    type="button"
                    className="chip lightsd__white"
                    style={{ "--swatch": kelvinToCss(white.kelvin) } as CSSProperties}
                    aria-pressed={kelvin > 0 && near(kelvin, white.kelvin)}
                    disabled={!on}
                    onClick={() => void send(light.id, { colourTemp: white.kelvin })}
                  >
                    {white.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="lightsd__colours" role="group" aria-label={`${light.name} colours`}>
                {COLOURS.map((preset) => (
                  <button
                    key={preset.hue}
                    type="button"
                    className="lightsd__colour"
                    style={{ "--swatch": hueToCss(preset.hue, 100) } as CSSProperties}
                    aria-label={preset.label}
                    aria-pressed={kelvin === 0 && saturation > 50 && nearHue(hue, preset.hue)}
                    disabled={!on}
                    onClick={() => colour({ hue: preset.hue, saturation: 100 })}
                  />
                ))}
              </div>
              <CommitSlider
                label={`${light.name} hue`}
                caption="Colour"
                className="lightsd__slider lightsd__slider--hue"
                min={0}
                max={360}
                value={hue}
                disabled={!on}
                onCommit={(next) => colour({ hue: next })}
                format={(shown) => `${shown}°`}
              />
              <CommitSlider
                label={`${light.name} saturation`}
                caption="Intensity"
                className="lightsd__slider lightsd__slider--saturation"
                min={0}
                max={100}
                value={saturation}
                disabled={!on}
                onCommit={(next) => colour({ saturation: next })}
                format={(shown) => `${shown}%`}
                style={{ "--to": hueToCss(hue, 100) }}
              />
            </>
          )}
        </>
      )}
    </li>
  );
}
