import { useNow } from "../lib/useNow.js";
import { clockTime, dateKey, dayPhrase } from "../lib/zoned.js";
import { formatChange, formatDuration, moonNow, moonPath, sunToday } from "./sunMoon.js";
import type { WidgetProps } from "./types.js";

function MoonIcon({ phase, size }: { phase: number; size: number }) {
  const r = size / 2 - 1;
  const c = size / 2;
  return (
    <svg className="sunmoon__moon" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <circle cx={c} cy={c} r={r} className="sunmoon__shadow" />
      <path d={moonPath(phase, c, c, r)} className="sunmoon__lit" />
    </svg>
  );
}

/**
 * Sunrise, sunset and whether the days are drawing in, plus tonight's moon.
 * Worked out locally from the dashboard's location: no service to fail.
 */
export function SunMoonWidget({ config }: WidgetProps) {
  const now = useNow();
  const { lat, lon, timezone } = config.location;
  const clock = config.units.clock;
  const sun = sunToday(now, lat, lon, timezone);
  const moon = moonNow(now);

  const time = (at: Date | null) => {
    if (!at) return "—";
    const { time, meridiem } = clockTime(at, timezone, clock);
    return (
      <span>
        {time}
        {meridiem && <span className="sunmoon__meridiem">{meridiem}</span>}
      </span>
    );
  };
  const nextDay = dayPhrase(dateKey(moon.next.at, timezone), dateKey(now, timezone));

  return (
    <div className="sunmoon">
      <dl className="sunmoon__sun tnum">
        <div>
          <dt>Sunrise</dt>
          <dd>{time(sun.sunrise)}</dd>
        </div>
        <div>
          <dt>Sunset</dt>
          <dd>{time(sun.sunset)}</dd>
        </div>
        <div className="sunmoon__daylight">
          <dt>Daylight</dt>
          <dd>
            {sun.dayLength === null ? "—" : formatDuration(sun.dayLength)}
            {sun.change !== null && <span className="sunmoon__change">{formatChange(sun.change)} on yesterday</span>}
          </dd>
        </div>
      </dl>

      <div className="sunmoon__moonrow">
        <MoonIcon phase={moon.phase} size={44} />
        <div>
          <p className="sunmoon__phase">{moon.name}</p>
          <p className="sunmoon__detail">
            {Math.round(moon.illumination * 100)}% lit · {moon.next.kind.toLowerCase()} {nextDay}
          </p>
        </div>
      </div>
    </div>
  );
}
