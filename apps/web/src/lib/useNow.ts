import { useEffect, useState } from "react";

/**
 * The current time, refreshed on each boundary of `stepMs` (the minute, by
 * default) rather than every `stepMs` from mount, so things like "is this
 * event over yet" change when a clock on the wall would say they do.
 */
export function useNow(stepMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, stepMs - (Date.now() % stepMs));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [stepMs]);
  return now;
}
