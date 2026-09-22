import type { CalendarSnapshot } from "@home-dash/shared";
import { useFitCount } from "../lib/useFitCount.js";
import { useNow } from "../lib/useNow.js";
import { buildAgenda, buildLater, type LaterItem, type When } from "./agenda.js";
import type { WidgetProps } from "./types.js";

interface CalendarOptions {
  /**
   * Days listed one by one, starting today. Capped by calendar.daysAhead in
   * config. Everything past it goes under "Later", as far as the card allows.
   */
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

/**
 * What is beyond the listed days, filling whatever room is left on the card.
 *
 * The list is measured rather than counted out: the tile is a fixed cell, so
 * how many events fit depends on the card's height and on how many headings
 * the days above it needed.
 */
function Later({ items }: { items: LaterItem[] }) {
  const { ref, limit } = useFitCount<HTMLUListElement>(items.map((item) => item.key).join());
  // While limit is null every item is rendered, so the measurement sees the
  // whole list; the card clips it, so that pass is never visible.
  const shown = limit === null ? items : items.slice(0, limit);

  return (
    <section className="agenda__later">
      {limit !== 0 && <h3 className="agenda__label agenda__label--later">Later</h3>}
      <ul className="agenda__items agenda__later-items" ref={ref}>
        {shown.map((item) => (
          <li className="agenda__item" key={item.key}>
            <span className="agenda__when tnum">{item.date}</span>
            <span className="agenda__what">
              <span className="agenda__title">{item.event.title}</span>
              {item.event.location && <span className="agenda__location">{item.event.location}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CalendarWidget({ instance, config, envelope }: WidgetProps<CalendarSnapshot>) {
  // Re-evaluated every minute, so finished events drop off and "now" moves
  // along between fetches.
  const now = useNow();
  const data = envelope?.data;
  if (!data) return null;

  const options = instance.options as CalendarOptions;
  const daysAhead = config.calendar.daysAhead;
  const days = Math.max(1, Math.min(options.days ?? 3, daysAhead));
  const { timezone } = config.location;
  const agenda = buildAgenda(data.events, now, timezone, days, config.units.clock);
  const later = buildLater(data.events, now, timezone, days, daysAhead, config.units.clock);

  if (agenda.length === 0 && later.length === 0) {
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
      {later.length > 0 && <Later items={later} />}
    </div>
  );
}
