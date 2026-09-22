import { useMemo, useState } from "react";
import type { CalendarSnapshot } from "@home-dash/shared";
import { useNow } from "../../lib/useNow.js";
import { dateKey, dayLabel, noonOf } from "../../lib/zoned.js";
import { eventSpan } from "../agenda.js";
import { addMonths, eventsOn, monthGrid, monthLabel, monthOf, reachableMonths, type MonthDay } from "../month.js";
import type { WidgetProps } from "../types.js";

/** Chips beyond this are counted rather than listed; a cell has only so much room. */
const CHIPS_PER_DAY = 3;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Cell({ day, selected, onPick }: { day: MonthDay; selected: boolean; onPick: (key: string) => void }) {
  const extra = day.items.length - CHIPS_PER_DAY;
  return (
    <button
      type="button"
      className="calm__cell"
      data-in-month={day.inMonth}
      data-today={day.isToday}
      data-past={day.past}
      data-selected={selected}
      aria-pressed={selected}
      aria-label={`${dayLabel(day.dateKey, day.dateKey)}, ${day.items.length} events`}
      onClick={() => onPick(day.dateKey)}
    >
      <span className="calm__date tnum">{day.dayOfMonth}</span>
      <span className="calm__chips">
        {day.items.slice(0, CHIPS_PER_DAY).map((item) => (
          <span className="calm__chip" key={item.key} data-all-day={item.event.allDay}>
            <span
              className="calm__dot"
              aria-hidden="true"
              style={item.event.colour ? { background: item.event.colour } : undefined}
            />
            {item.time && <span className="calm__time tnum">{item.time}</span>}
            <span className="calm__chip-title">{item.event.title}</span>
          </span>
        ))}
        {extra > 0 && <span className="calm__more">+{extra} more</span>}
      </span>
    </button>
  );
}

/**
 * The month the way a wall calendar shows it, with the day you tap opened
 * beside it.
 *
 * The arrows only reach months the feed actually covers - `calendar.daysAhead`
 * is set wide enough for this month and the next - because an uncovered month
 * would draw empty cells that read exactly like free days.
 */
export function CalendarDetail({ config, envelope }: WidgetProps<CalendarSnapshot>) {
  const now = useNow();
  const { timezone } = config.location;
  const today = dateKey(now, timezone);

  const months = reachableMonths(today, config.calendar.daysAhead);
  const [month, setMonth] = useState(() => monthOf(today));
  const [picked, setPicked] = useState<string | null>(null);

  const data = envelope?.data;
  const events = data?.events ?? [];

  // Following the month keeps the panel honest: stepping to October should not
  // leave September's day open beside it.
  const selected = picked && monthOf(picked) === month ? picked : monthOf(today) === month ? today : `${month}-01`;

  const weeks = useMemo(
    () => monthGrid(month, events, today, timezone, config.units.clock),
    [month, events, today, timezone, config.units.clock],
  );
  const dayEvents = useMemo(() => eventsOn(events, selected, timezone), [events, selected, timezone]);

  if (!data) return null;

  const calendarName = new Map(data.calendars.map((c) => [c.id, c.name]));
  const several = data.calendars.length > 1;
  const at = months.indexOf(month);
  const step = (by: number) => {
    const next = addMonths(month, by);
    if (months.includes(next)) setMonth(next);
  };

  return (
    <div className="detail calm">
      <div className="calm__month">
        <header className="calm__head">
          <button
            type="button"
            className="calm__arrow"
            onClick={() => step(-1)}
            disabled={at <= 0}
            aria-label="Previous month"
          >
            ‹
          </button>
          <h3 className="calm__title">{monthLabel(month)}</h3>
          <button
            type="button"
            className="calm__arrow"
            onClick={() => step(1)}
            disabled={at < 0 || at >= months.length - 1}
            aria-label="Next month"
          >
            ›
          </button>
        </header>

        <div className="calm__weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span className="calm__weekday" key={day}>
              {day}
            </span>
          ))}
        </div>

        <div className="calm__grid" style={{ "--calm-weeks": weeks.length } as React.CSSProperties}>
          {weeks.flat().map((day) => (
            <Cell key={day.dateKey} day={day} selected={day.dateKey === selected} onPick={setPicked} />
          ))}
        </div>
      </div>

      <aside className="calm__day">
        <h3 className="calm__day-title">
          {dayLabel(selected, today)}
          <span className="calm__day-date">
            {new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(
              noonOf(selected),
            )}
          </span>
        </h3>

        {dayEvents.length === 0 ? (
          <p className="calm__empty">{selected < today ? "Past days are not kept." : "Nothing on."}</p>
        ) : (
          <ul className="cald__items">
            {dayEvents.map((event) => (
              <li
                className="cald__item"
                data-now={!event.allDay && Date.parse(event.start) <= now.getTime() && now.getTime() < Date.parse(event.end)}
                key={`${event.calendarId}/${event.id}`}
              >
                <span className="cald__when tnum">{eventSpan(event, timezone, config.units.clock)}</span>
                <span className="cald__title">{event.title}</span>
                {event.location && <span className="cald__location">{event.location}</span>}
                {event.description && <span className="cald__description">{event.description}</span>}
                {several && (
                  <span className="cald__calendar">
                    <span
                      className="cald__dot"
                      aria-hidden="true"
                      style={event.colour ? { background: event.colour } : undefined}
                    />
                    {calendarName.get(event.calendarId) ?? event.calendarId}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
