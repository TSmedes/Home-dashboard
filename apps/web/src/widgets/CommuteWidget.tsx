import type { CommuteSnapshot } from "@home-dash/shared";
import { clockTime } from "../lib/zoned.js";
import type { WidgetProps } from "./types.js";

/** "34 min", "1 h 05 min". */
export function formatMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Traffic worth mentioning: five minutes, or a fifth of the trip. */
const noticeable = (delay: number, travel: number) => delay >= 300 || delay >= travel * 0.2;
/** Traffic worth warning about: fifteen minutes, or half as long again. */
const heavy = (delay: number, travel: number) => delay >= 900 || delay >= (travel - delay) * 0.5;

export function CommuteWidget({ config, envelope }: WidgetProps<CommuteSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;
  const { timezone } = config.location;
  const clock = config.units.clock;

  const arrive = (iso: string) => {
    const { time, meridiem } = clockTime(new Date(iso), timezone, clock);
    return meridiem ? `${time} ${meridiem}` : time;
  };

  return (
    <div className="commute">
      <ul className="commute__list">
        {data.routes.map((route) => (
          <li key={route.id} className="commute__row" data-heavy={heavy(route.delaySeconds, route.travelSeconds)}>
            <span className="commute__name">{route.name}</span>
            <span className="commute__time tnum">{formatMinutes(route.travelSeconds)}</span>
            <span className="commute__detail tnum">
              {noticeable(route.delaySeconds, route.travelSeconds)
                ? `+${formatMinutes(route.delaySeconds)} traffic · `
                : ""}
              arrive {arrive(route.arrival)}
            </span>
          </li>
        ))}
      </ul>
      {data.failed.length > 0 && (
        <p className="commute__failed">No route to {data.failed.map((f) => f.name).join(", ")} right now.</p>
      )}
    </div>
  );
}
