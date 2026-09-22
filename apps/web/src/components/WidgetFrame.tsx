import type { ReactNode, Ref } from "react";
import type { WidgetEnvelope } from "@home-dash/shared";
import { WIDGET_NAMES } from "../widgets/names.js";

interface Props {
  /** The widget type; each type gets its own tile tint. */
  type: string;
  title?: string | undefined;
  chrome: boolean;
  envelope: WidgetEnvelope<unknown> | null;
  timezone: string;
  clock: "12h" | "24h";
  /** Set on a tile that can grow to full screen; given the button pressed. */
  onExpand?: ((from: HTMLElement) => void) | undefined;
  /** Set when this is the full-screen view rather than the tile. */
  expanded?: { onClose: () => void; closeRef: Ref<HTMLButtonElement> } | undefined;
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

function Corners() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5 11.5 8.5M3.5 16.5l5-5" />
    </svg>
  );
}

function Cross() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

/**
 * Shared chrome: optional title, the staleness marker, and the states a widget
 * can be in before it has data. Keeping these here means every integration gets
 * the same honest behaviour for free.
 */
export function WidgetFrame({ type, title, chrome, envelope, timezone, clock, onExpand, expanded, children }: Props) {
  const isStale = envelope?.stale === true && envelope.data !== null;
  const hasNothing = envelope !== null && envelope.data === null;
  const name = title ?? WIDGET_NAMES[type] ?? type;
  // The full-screen view always names itself; a tile only when configured to.
  const heading = expanded ? name : title;

  const expandButton = onExpand && (
    <button
      type="button"
      // Without a title there is no header to sit in, and the whole tile is a
      // tap target anyway: the button stays out of sight until it has focus.
      className={heading ? "widget__expand" : "widget__expand widget__expand--quiet"}
      aria-label={`Open ${name}`}
      onClick={(event) => onExpand(event.currentTarget)}
    >
      <Corners />
    </button>
  );

  const body = (
    <>
      {(heading || isStale || expanded) && (
        <header className="widget__head">
          {heading ? <h2 className="widget__title">{heading}</h2> : <span />}
          <span className="widget__head-end">
            {isStale && envelope?.fetchedAt && (
              <span className="widget__stale" title={envelope.error?.message ?? undefined}>
                <span className="widget__stale-dot" aria-hidden="true" />
                {shortTime(envelope.fetchedAt, timezone, clock)}
              </span>
            )}
            {heading && expandButton}
            {expanded && (
              <button
                ref={expanded.closeRef}
                type="button"
                className="widget__close"
                aria-label={`Close ${name}`}
                onClick={expanded.onClose}
              >
                <Cross />
              </button>
            )}
          </span>
        </header>
      )}
      {!heading && expandButton}

      {hasNothing ? (
        <div className="widget-message">
          <p>{envelope?.error ? "Can't reach this right now." : "Waiting for the first update."}</p>
        </div>
      ) : expanded ? (
        <div className="widget__scroll">{children}</div>
      ) : (
        children
      )}
    </>
  );

  const className = [
    "widget",
    chrome && "surface",
    `widget--${type}`,
    onExpand && "widget--expandable",
    expanded && "widget--expanded",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className}>
      {/* Its own layer in the full-screen view, so it can fade in while the card grows. */}
      {expanded ? <div className="widget__inner">{body}</div> : body}
    </section>
  );
}
