import type { CommuteSnapshot } from "@home-dash/shared";
import { clockTime } from "../../lib/zoned.js";
import { formatMinutes } from "../CommuteWidget.js";
import type { WidgetProps } from "../types.js";
import { Stats } from "./parts.js";

function distance(meters: number, imperial: boolean): string {
  return imperial ? `${(meters / 1609.344).toFixed(1)} mi` : `${(meters / 1000).toFixed(1)} km`;
}

/** Each destination with the trip broken down: free-flowing time, what traffic adds, the distance. */
export function CommuteDetail({ config, envelope }: WidgetProps<CommuteSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;
  const { timezone } = config.location;
  // Miles go with Fahrenheit and mph; the dashboard has no separate distance unit.
  const imperial = config.units.wind === "mph";

  const arrive = (iso: string) => {
    const { time, meridiem } = clockTime(new Date(iso), timezone, config.units.clock);
    return meridiem ? `${time} ${meridiem}` : time;
  };

  return (
    <div className="detail commuted">
      {data.routes.map((route) => {
        const share = route.travelSeconds > 0 ? route.delaySeconds / route.travelSeconds : 0;
        return (
          <section key={route.id} className="commuted__route">
            <header className="commuted__head">
              <h3 className="commuted__name">{route.name}</h3>
              <span className="commuted__time tnum">{formatMinutes(route.travelSeconds)}</span>
            </header>
            {/* How much of the trip is traffic, as a bar split in two. */}
            <div className="commuted__split" aria-hidden="true">
              <span className="commuted__free" style={{ flexGrow: 1 - share }} />
              {share > 0 && <span className="commuted__delay" style={{ flexGrow: share }} />}
            </div>
            <Stats
              items={[
                { label: "Arrive", value: arrive(route.arrival), detail: "leaving now" },
                {
                  label: "Traffic",
                  value: route.delaySeconds >= 60 ? `+${formatMinutes(route.delaySeconds)}` : "None",
                },
                { label: "Empty roads", value: formatMinutes(route.travelSeconds - route.delaySeconds) },
                { label: "Distance", value: distance(route.lengthMeters, imperial) },
              ]}
            />
          </section>
        );
      })}
      {data.failed.map((f) => (
        <p key={f.id} className="commute__failed">
          No route to {f.name}: {f.message}
        </p>
      ))}
    </div>
  );
}
