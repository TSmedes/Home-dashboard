import type { SystemSnapshot } from "@home-dash/shared";
import { Meter } from "./SystemParts.js";
import { levelFor } from "./system.js";
import type { WidgetProps } from "./types.js";

const LEVEL_WORD = { ok: null, warn: "Warm", crit: "Hot" } as const;

/** Bars run from room temperature to a little past the hot threshold. */
const BAR_FLOOR = 20;

/**
 * One row per part - CPU, drives, board - at its hottest sensor, hottest
 * first. Thresholds are set in °C; readings follow the dashboard's units.
 */
export function TempsWidget({ instance, config, envelope }: WidgetProps<SystemSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;
  const { tempWarn, tempCrit } = config.system;
  const fahrenheit = config.units.temperature === "fahrenheit";
  const limit = typeof instance.options.limit === "number" ? instance.options.limit : 6;
  const temps = data.temps.slice(0, limit);

  if (temps.length === 0) {
    return (
      <div className="widget-message">
        <p>No temperature sensors found.</p>
        <p className="widget-message__detail">Virtual machines and some containers can't see them.</p>
      </div>
    );
  }

  const ceiling = tempCrit + 10;
  return (
    <ul className="sysrows sysrows--compact">
      {temps.map((t) => {
        const level = levelFor(t.celsius, tempWarn, tempCrit);
        const shown = fahrenheit ? t.celsius * 1.8 + 32 : t.celsius;
        const word = LEVEL_WORD[level];
        return (
          <li key={t.label} className="sysrow" data-level={level}>
            <span className="sysrow__name">
              {t.label}
              {word && <span className="sysrow__alert">{word}</span>}
            </span>
            <span className="sysrow__value tnum">{Math.round(shown)}°</span>
            <Meter
              value={((t.celsius - BAR_FLOOR) / (ceiling - BAR_FLOOR)) * 100}
              level={level}
              label={`${t.label} ${Math.round(shown)} degrees`}
            />
          </li>
        );
      })}
    </ul>
  );
}
