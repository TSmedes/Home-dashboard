import type { Location, Units, WeatherSnapshot } from "@home-dash/shared";

/** Shape of the slice of the Open-Meteo response we ask for. */
export interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    is_day: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
  };
  current_units: Record<string, string>;
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
    weather_code: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    sunrise: string[];
    sunset: string[];
  };
}

const WIND_UNIT: Record<Units["wind"], string> = {
  mph: "mph",
  kmh: "kmh",
  ms: "ms",
  kn: "kn",
};

export function buildUrl(location: Location, units: Units, forecastDays = 7): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.lat));
  url.searchParams.set("longitude", String(location.lon));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
  );
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code");
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
  );
  url.searchParams.set("temperature_unit", units.temperature);
  url.searchParams.set("wind_speed_unit", WIND_UNIT[units.wind]);
  url.searchParams.set("precipitation_unit", units.temperature === "fahrenheit" ? "inch" : "mm");
  url.searchParams.set("timezone", location.timezone);
  url.searchParams.set("forecast_days", String(forecastDays));
  return url.toString();
}

/**
 * Open-Meteo returns parallel arrays; widgets want a list of objects. Rounding
 * happens here so the display layer never has to decide how precise to be.
 */
export function mapResponse(raw: OpenMeteoResponse, units: Units): WeatherSnapshot {
  const { current, hourly, daily } = raw;

  return {
    now: {
      temperature: Math.round(current.temperature_2m),
      apparentTemperature: Math.round(current.apparent_temperature),
      humidity: Math.round(current.relative_humidity_2m),
      windSpeed: Math.round(current.wind_speed_10m),
      windDirection: Math.round(current.wind_direction_10m),
      precipitation: current.precipitation,
      isDay: current.is_day === 1,
      code: current.weather_code,
    },
    hourly: hourly.time.map((time, i) => ({
      time,
      temperature: Math.round(hourly.temperature_2m[i] ?? 0),
      precipitationProbability: hourly.precipitation_probability[i] ?? 0,
      code: hourly.weather_code[i] ?? 0,
    })),
    daily: daily.time.map((date, i) => ({
      date,
      min: Math.round(daily.temperature_2m_min[i] ?? 0),
      max: Math.round(daily.temperature_2m_max[i] ?? 0),
      precipitationProbability: daily.precipitation_probability_max[i] ?? 0,
      code: daily.weather_code[i] ?? 0,
      sunrise: daily.sunrise[i] ?? "",
      sunset: daily.sunset[i] ?? "",
    })),
    units: {
      temperature: units.temperature === "fahrenheit" ? "°F" : "°C",
      wind: units.wind,
    },
  };
}

export async function fetchWeather(
  location: Location,
  units: Units,
  forecastDays = 7,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherSnapshot> {
  const response = await fetchImpl(buildUrl(location, units, forecastDays), {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Open-Meteo returned ${response.status} ${response.statusText}`);
  }
  return mapResponse((await response.json()) as OpenMeteoResponse, units);
}
