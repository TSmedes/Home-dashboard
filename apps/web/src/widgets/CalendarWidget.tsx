import type { CalendarSnapshot } from "@home-dash/shared";
import { useNow } from "../lib/useNow.js";
import { buildAgenda, type When } from "./agenda.js";
import type { WidgetProps } from "./types.js";

interface CalendarOptions {
  /** Days shown, starting today. Capped by calendar.daysAhead in config. */
  days?: number;
}

function WhenLabel({ when }: { when: When }) {
  if (when.kind === "allDay") return <>All day</>;
  return (
    <>
      {when.kind === "until" && <span className="agenda__until">until </span>}
      {when.time}
      {when.meridiem && <span className="agenda__meridiem">{when.meridiem}</span>}
    </>
  );
}

export function CalendarWidget({ instance, config, envelope }: WidgetProps<CalendarSnapshot>) {
  // Re-evaluated every minute, so finished events drop off and "now" moves
  // along between fetches.
  const now = useNow();
  const data = envelope?.data;
  if (!data) return null;

  const options = instance.options as CalendarOptions;
  const days = Math.max(1, Math.min(options.days ?? 3, config.calendar.daysAhead));
  const agenda = buildAgenda(data.events, now, config.location.timezone, days, config.units.clock);

  if (agenda.length === 0) {
    return (
      <div className="widget-message">
        <p>{days === 1 ? "Nothing else today." : `Nothing in the next ${days} days.`}</p>
      </div>
    );
  }

  return (
    <div className="agenda">
      {agenda.map((day) => (
        <section className="agenda__day" key={day.dateKey}>
          <h3 className="agenda__label">{day.label}</h3>
          <ul className="agenda__items">
            {day.items.map((item) => (
              <li className="agenda__item" data-now={item.now} key={item.key}>
                <span className="agenda__when tnum">
                  <WhenLabel when={item.when} />
                </span>
                <span className="agenda__what">
                  <span className="agenda__title">{item.event.title}</span>
                  {item.event.location && <span className="agenda__location">{item.event.location}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
