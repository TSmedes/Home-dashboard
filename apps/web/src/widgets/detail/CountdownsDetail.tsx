import type { CountdownsSnapshot } from "@home-dash/shared";
import { useNow } from "../../lib/useNow.js";
import { dateKey, daysBetween, noonOf } from "../../lib/zoned.js";
import type { WidgetProps } from "../types.js";

const fullDate = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Weeks as well as days once it is far enough off for days to stop meaning much. */
function inWeeks(days: number): string | null {
  if (days < 14) return null;
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  return `${weeks} weeks${rest ? `, ${rest} ${rest === 1 ? "day" : "days"}` : ""}`;
}

/** Every countdown still ahead, not just the tile's first few, with its full date. */
export function CountdownsDetail({ config, envelope }: WidgetProps<CountdownsSnapshot>) {
  const now = useNow();
  const data = envelope?.data;
  if (!data) return null;

  const today = dateKey(now, config.location.timezone);
  const items = data.countdowns.filter((c) => c.date >= today);

  if (items.length === 0) {
    return (
      <div className="widget-message">
        <p>Nothing to count down to.</p>
        <p className="widget-message__detail">
          Add {config.countdowns.calendarTag} to a calendar event, or list dates under countdowns: in config.yaml.
        </p>
      </div>
    );
  }

  return (
    <ul className="detail countd">
      {items.map((item) => {
        const days = daysBetween(today, item.date);
        const weeks = inWeeks(days);
        return (
          <li key={item.id} className="countd__card" data-today={days === 0}>
            <span className="countd__days tnum">
              {days === 0 ? "Today" : days}
              {days > 0 && <span className="countdown__unit">{days === 1 ? "day" : "days"}</span>}
            </span>
            <span className="countd__name">
              {item.emoji && <span aria-hidden="true">{item.emoji} </span>}
              {item.name}
            </span>
            <span className="countd__date">{fullDate.format(noonOf(item.date))}</span>
            <span className="countd__meta">
              {weeks && <span>{weeks}</span>}
              <span>{item.source === "calendar" ? "From the calendar" : "From config.yaml"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
