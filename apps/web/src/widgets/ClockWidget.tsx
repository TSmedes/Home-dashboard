import { useEffect, useState } from "react";
import type { WidgetProps } from "./types.js";

interface ClockOptions {
  /** "xl" is the night treatment: the clock is the whole dashboard. */
  size?: "default" | "xl";
  showSeconds?: boolean;
  showDate?: boolean;
}

function parts(now: Date, timezone: string, clock: "12h" | "24h", seconds: boolean) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
    hour12: clock === "12h",
  })
    .format(now)
    .replace(/\s?[AP]M$/i, "");

  const meridiem =
    clock === "12h"
      ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: true })
          .format(now)
          .replace(/^\d+\s?/, "")
          .toLowerCase()
      : "";

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  return { time, meridiem, date };
}

/**
 * The only widget with no server dependency. It carries the largest type on the
 * wall, which is what makes it read as the primary thing there.
 */
export function ClockWidget({ instance, config }: WidgetProps) {
  const options = instance.options as ClockOptions;
  const showSeconds = options.showSeconds ?? false;
  const showDate = options.showDate ?? true;
  const { timezone } = config.location;

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Tick on the second boundary rather than every 1000ms from mount, so the
    // minute changes on the wall when it changes on a watch.
    let timer: number;
    const schedule = () => {
      const delay = showSeconds ? 1000 - (Date.now() % 1000) : 60_000 - (Date.now() % 60_000);
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [showSeconds]);

  const { time, meridiem, date } = parts(now, timezone, config.units.clock, showSeconds);

  return (
    <div className={options.size === "xl" ? "clock clock--xl" : "clock"}>
      <div className="clock__time tnum">
        {time}
        {meridiem && <span className="clock__meridiem">{meridiem}</span>}
      </div>
      {showDate && <div className="clock__date">{date}</div>}
    </div>
  );
}
