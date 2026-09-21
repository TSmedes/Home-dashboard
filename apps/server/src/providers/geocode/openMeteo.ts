import type { Place } from "@home-dash/shared";

/**
 * Place search for the settings screen, through Open-Meteo's free geocoding
 * API - the same provider as the weather, so still no API key anywhere. Each
 * result carries its IANA timezone, which is what lets one pick set both the
 * weather location and the clock's zone.
 */

interface RawResult {
  name?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  admin1?: string;
  country?: string;
}

export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  const name = query.trim();
  if (name.length < 2) return [];

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "6");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`place search returned ${response.status}`);

  // No matches means no `results` key at all, not an empty list.
  const { results = [] } = (await response.json()) as { results?: RawResult[] };

  return results
    .filter((r): r is Required<Pick<RawResult, "name" | "latitude" | "longitude" | "timezone">> & RawResult =>
      Boolean(r.name && r.timezone && typeof r.latitude === "number" && typeof r.longitude === "number"),
    )
    .map((r) => ({
      label: [r.name, r.admin1 ?? r.country].filter(Boolean).join(", "),
      detail: r.country ?? "",
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone,
    }));
}
