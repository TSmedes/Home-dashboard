import type { CountdownsSnapshot } from "@home-dash/shared";
import { useNow } from "../lib/useNow.js";
import { dateKey, dayLabel, daysBetween } from "../lib/zoned.js";
import type { WidgetProps } from "./types.js";

interface CountdownOptions {
  /** How many to show; the rest wait their turn. */
  limit?: number;
}

/**
 * Days are counted here rather than on the server, so the numbers tick over
 * at midnight on the wall without waiting for the next hourly refresh.
 */
export function CountdownsWidget({ instance, config, envelope }: WidgetProps<CountdownsSnapshot>) {
  const now = useNow();
  const data = envelope?.data;
  if (!data) return null;

  const today = dateKey(now, config.location.timezone);
  const limit = (instance.options as CountdownOptions).limit ?? 6;
  const items = data.countdowns.filter((c) => c.date >= today).slice(0, limit);

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
    <ul className="countdowns">
      {items.map((item) => {
        const days = daysBetween(today, item.date);
        return (
          <li key={item.id} className="countdown" data-today={days === 0}>
            <span className="countdown__days tnum">
              {days === 0 ? "Today" : days}
              {days > 0 && <span className="countdown__unit">{days === 1 ? "day" : "days"}</span>}
            </span>
            <span className="countdown__what">
              <span className="countdown__name">
                {item.emoji && <span aria-hidden="true">{item.emoji} </span>}
                {item.name}
              </span>
              <span className="countdown__date">{dayLabel(item.date, today)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
