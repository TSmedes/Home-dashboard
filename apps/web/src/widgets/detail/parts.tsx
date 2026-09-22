import type { ReactNode } from "react";

/**
 * Pieces every expanded view is built from, so they read as one family:
 * a labelled section, and a row of stat cards.
 */

export function Section({
  title,
  aside,
  className = "",
  children,
}: {
  title?: string;
  /** A short note at the right of the heading. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`detail__section ${className}`}>
      {(title || aside) && (
        <header className="detail__section-head">
          {title && <h3 className="detail__heading">{title}</h3>}
          {aside && <span className="detail__aside">{aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export interface Stat {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}

export function Stats({ items }: { items: Stat[] }) {
  return (
    <dl className="detail__stats">
      {items.map((item) => (
        <div className="detail__stat" key={item.label}>
          <dt>{item.label}</dt>
          <dd className="tnum">{item.value}</dd>
          {item.detail && <dd className="detail__stat-detail">{item.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A number that may be missing from a snapshot written by an older server. */
export const shown = (value: number | undefined, suffix = "") =>
  typeof value === "number" && Number.isFinite(value) ? `${value}${suffix}` : "—";
