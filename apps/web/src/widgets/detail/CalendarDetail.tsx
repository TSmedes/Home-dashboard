import type { CalendarSnapshot } from "@home-dash/shared";
import { useNow } from "../../lib/useNow.js";
import { buildAgenda, eventSpan } from "../agenda.js";
import type { WidgetProps } from "../types.js";

/**
 * Every day the server fetches, not just the tile's few, with each event's
 * full time, place, notes and calendar. The calendars are read-only iCal
 * feeds, so there is nothing to change here - only more to read.
 */
export function CalendarDetail({ config, envelope }: WidgetProps<CalendarSnapshot>) {
  const now = useNow();
  const data = envelope?.data;
  if (!data) return null;

  const { timezone } = config.location;
  const days = config.calendar.daysAhead;
  const agenda = buildAgenda(data.events, now, timezone, days, config.units.clock);
  const calendarName = new Map(data.calendars.map((c) => [c.id, c.name]));
  const several = data.calendars.length > 1;

  if (agenda.length === 0) {
    return (
      <div className="widget-message">
        <p>Nothing in the next {days} days.</p>
      </div>
    );
  }

  return (
    <div className="detail cald">
      {agenda.map((day) => (
        <section className="cald__day" key={day.dateKey}>
          <h3 className="cald__label">
            {day.label}
            <span className="cald__count">
              {day.items.length} {day.items.length === 1 ? "event" : "events"}
            </span>
          </h3>
          <ul className="cald__items">
            {day.items.map((item) => (
              <li className="cald__item" data-now={item.now} key={item.key}>
                <span className="cald__when tnum">{eventSpan(item.event, timezone, config.units.clock)}</span>
                <span className="cald__title">{item.event.title}</span>
                {item.event.location && <span className="cald__location">{item.event.location}</span>}
                {item.event.description && <span className="cald__description">{item.event.description}</span>}
                {several && (
                  <span className="cald__calendar">
                    <span
                      className="cald__dot"
                      aria-hidden="true"
                      style={item.event.colour ? { background: item.event.colour } : undefined}
                    />
                    {calendarName.get(item.event.calendarId) ?? item.event.calendarId}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
