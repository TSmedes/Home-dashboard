import { useNow } from "../../lib/useNow.js";
import { clockTime, dateKey, daysBetween, zonedMidnight } from "../../lib/zoned.js";
import {
  formatChange,
  formatDuration,
  moonNow,
  moonPath,
  moonRiseSet,
  nextPhases,
  sunDetail,
  sunToday,
} from "../sunMoon.js";
import type { WidgetProps } from "../types.js";
import { Section, Stats } from "./parts.js";

const weekdayDate = (at: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone }).format(at);

const inDays = (days: number) => (days === 0 ? "tonight" : days === 1 ? "tomorrow" : `in ${days} days`);

/** The sun from first light to last, and the moon tonight and next. */
export function SunMoonDetail({ config }: WidgetProps) {
  const now = useNow();
  const { lat, lon, timezone } = config.location;
  const today = dateKey(now, timezone);
  const sun = sunDetail(now, lat, lon, timezone);
  const day = sunToday(now, lat, lon, timezone);
  const moon = moonNow(now);
  const moonTimes = moonRiseSet(zonedMidnight(today, timezone), lat, lon);
  const phases = nextPhases(now);

  const time = (at: Date | null) => {
    if (!at) return "—";
    const { time, meridiem } = clockTime(at, timezone, config.units.clock);
    return meridiem ? `${time} ${meridiem}` : time;
  };

  return (
    <div className="detail sunmoond">
      <Section title="Sun">
        <Stats
          items={[
            { label: "First light", value: time(sun.dawn) },
            { label: "Sunrise", value: time(sun.sunrise) },
            { label: "Midday", value: time(sun.solarNoon) },
            { label: "Golden hour", value: time(sun.goldenHour) },
            { label: "Sunset", value: time(sun.sunset) },
            { label: "Last light", value: time(sun.dusk) },
            {
              label: "Daylight",
              value: day.dayLength === null ? "—" : formatDuration(day.dayLength),
              detail: day.change !== null ? `${formatChange(day.change)} on yesterday` : undefined,
            },
          ]}
        />
      </Section>

      <Section title="Moon" className="sunmoond__moon-section">
        <div className="sunmoond__moon">
          <svg className="sunmoon__moon" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
            <circle cx={60} cy={60} r={58} className="sunmoon__shadow" />
            <path d={moonPath(moon.phase, 60, 60, 58)} className="sunmoon__lit" />
          </svg>
          <div>
            <p className="sunmoond__phase">{moon.name}</p>
            <p className="sunmoon__detail">{Math.round(moon.illumination * 100)}% lit</p>
          </div>
        </div>
        <Stats
          items={[
            { label: "Moonrise", value: time(moonTimes.rise) },
            { label: "Moonset", value: time(moonTimes.set) },
            ...phases.map((phase) => ({
              label: phase.kind,
              value: weekdayDate(phase.at, timezone),
              detail: inDays(daysBetween(today, dateKey(phase.at, timezone))),
            })),
          ]}
        />
      </Section>
    </div>
  );
}
