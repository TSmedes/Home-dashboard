import type { ReactNode } from "react";
import type { WidgetEnvelope } from "@home-dash/shared";

interface Props {
  title?: string | undefined;
  chrome: boolean;
  envelope: WidgetEnvelope<unknown> | null;
  timezone: string;
  clock: "12h" | "24h";
  children: ReactNode;
}

function shortTime(iso: string, timezone: string, clock: "12h" | "24h"): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: clock === "12h",
  }).format(new Date(iso));
}

/**
 * Shared chrome: optional title, the staleness marker, and the states a widget
 * can be in before it has data. Keeping these here means every integration gets
 * the same honest behaviour for free.
 */
export function WidgetFrame({ title, chrome, envelope, timezone, clock, children }: Props) {
  const isStale = envelope?.stale === true && envelope.data !== null;
  const hasNothing = envelope !== null && envelope.data === null;

  return (
    <section className={chrome ? "widget surface" : "widget"}>
      {(title || isStale) && (
        <header className="widget__head">
          {title ? <h2 className="widget__title">{title}</h2> : <span />}
          {isStale && envelope?.fetchedAt && (
            <span className="widget__stale" title={envelope.error?.message ?? undefined}>
              <span className="widget__stale-dot" aria-hidden="true" />
              {shortTime(envelope.fetchedAt, timezone, clock)}
            </span>
          )}
        </header>
      )}

      {hasNothing ? (
        <div className="widget-message">
          <p>{envelope?.error ? "Can't reach this right now." : "Waiting for the first update."}</p>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
