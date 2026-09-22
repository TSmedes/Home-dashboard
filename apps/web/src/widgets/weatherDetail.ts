const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Where the wind comes from, to the nearest of eight points. */
export function compass(degrees: number): (typeof POINTS)[number] {
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return POINTS[index]!;
}

/** The WHO's words for a UV index. */
export function uvLevel(uv: number): "Low" | "Moderate" | "High" | "Very high" | "Extreme" {
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very high";
  return "Extreme";
}

/**
 * A day's low-to-high bar on one scale for the whole forecast, so a cold day
 * sits visibly to the left of a warm one. Percentages of the track.
 */
export function rangeBar(day: { min: number; max: number }, weekMin: number, weekMax: number) {
  const span = weekMax - weekMin;
  if (span <= 0) return { left: 0, width: 100 };
  const left = ((day.min - weekMin) / span) * 100;
  const width = Math.max(((day.max - day.min) / span) * 100, 4);
  return { left: Math.round(left * 10) / 10, width: Math.round(Math.min(width, 100 - left) * 10) / 10 };
}
