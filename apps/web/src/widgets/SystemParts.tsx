import { seriesArea, seriesPath, type Level } from "./system.js";

/**
 * Pieces the homelab widgets share. Colour carries the level, but every
 * warning also comes with words, so nothing is said by colour alone.
 */

/** A horizontal bar, 0-100, coloured by level. */
export function Meter({ value, level, label }: { value: number; level: Level; label: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      className="meter"
      data-level={level}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      <div className="meter__fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** Recent history as a line with a soft fill, stretched to its box. */
export function Spark({
  values,
  max,
  className = "",
  width = 200,
  height = 48,
}: {
  values: number[];
  max?: number;
  className?: string;
  width?: number;
  height?: number;
}) {
  const line = seriesPath(values, width, height, max);
  const area = seriesArea(values, width, height, max);
  if (!line || !area) return <div className={`spark spark--empty ${className}`} aria-hidden="true" />;
  return (
    <svg className={`spark ${className}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="spark__area" d={area} />
      <path className="spark__line" d={line} />
    </svg>
  );
}
