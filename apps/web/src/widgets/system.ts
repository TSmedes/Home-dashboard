/** Helpers shared by the homelab widgets: units, thresholds and sparklines. */

export type Level = "ok" | "warn" | "crit";

/** Where a reading sits against its two thresholds. */
export function levelFor(value: number, warn: number, crit: number): Level {
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "ok";
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** "512 MB", "7.8 GB", "3.64 TB": three significant figures, binary units like df -h. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** Network speed in bits per second, the way connections are sold: "940 Mb/s". */
export function formatRate(bytesPerSecond: number): string {
  const bits = Math.max(0, bytesPerSecond) * 8;
  if (bits < 1000) return `${Math.round(bits)} b/s`;
  const units = ["Kb/s", "Mb/s", "Gb/s"];
  let value = bits / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}

/** "12 days 4 h", "5 h 12 min", "8 min". */
export function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} ${days === 1 ? "day" : "days"} ${hours % 24} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  return `${Math.max(minutes, 0)} min`;
}

/** Whole-number percent of a part in a whole, 0 when the whole is empty. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * An SVG path through recent values, spread evenly across the width, with 0
 * at the bottom and `max` (or the largest value) at the top. Null when there
 * is not yet enough history to draw a line.
 */
export function seriesPath(values: number[], width: number, height: number, max?: number): string | null {
  if (values.length < 2) return null;
  const top = max ?? Math.max(...values, 1e-9);
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const y = height - (Math.min(Math.max(v, 0), top) / top) * height;
      return `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** The same line closed down to the baseline, for a soft fill beneath it. */
export function seriesArea(values: number[], width: number, height: number, max?: number): string | null {
  const line = seriesPath(values, width, height, max);
  return line ? `${line} L ${width} ${height} L 0 ${height} Z` : null;
}
