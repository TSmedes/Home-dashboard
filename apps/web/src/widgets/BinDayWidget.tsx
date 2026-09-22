import { useNow } from "../lib/useNow.js";
import { dayLabel, dateKey } from "../lib/zoned.js";
import { upcomingPickups, type Pickup } from "./binDay.js";
import type { WidgetProps } from "./types.js";

/** "the trash", "the trash and recycling", "the trash, recycling and yard waste". */
function joinNames(pickups: Pickup[]): string {
  const names = pickups.map((p) => p.name.toLowerCase());
  if (names.length <= 1) return `the ${names[0] ?? ""}`;
  return `the ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function BinDayWidget({ config }: WidgetProps) {
  const now = useNow();
  const timezone = config.location.timezone;

  if (config.bins.length === 0) {
    return (
      <div className="widget-message">
        <p>No pickups set up.</p>
        <p className="widget-message__detail">Add your collection days under bins: in config.yaml.</p>
      </div>
    );
  }

  const today = dateKey(now, timezone);
  const pickups = upcomingPickups(config.bins, now, timezone);
  const tonight = pickups.filter((p) => p.urgency === "out-tonight");
  const collecting = pickups.filter((p) => p.urgency === "today");

  return (
    <div className="bins">
      {tonight.length > 0 && <p className="bins__callout">Put {joinNames(tonight)} out tonight</p>}
      {tonight.length === 0 && collecting.length > 0 && (
        <p className="bins__callout">Collecting {joinNames(collecting)} today</p>
      )}
      <ul className="bins__list">
        {pickups.map((pickup) => (
          <li key={pickup.name} className="bins__row" data-urgent={pickup.urgency !== null}>
            <span className="bins__name">{pickup.name}</span>
            <span className="bins__when">
              {dayLabel(pickup.date, today)}
              {pickup.moved && <span className="bins__moved"> · moved</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
