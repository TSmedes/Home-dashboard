/** WMO interpretation codes, grouped into the handful of things worth drawing. */
export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "thunder";

interface Condition {
  sky: Sky;
  label: string;
  /** Whether water is falling. Drives the blue accent in the weather widget. */
  wet: boolean;
}

const CONDITIONS: Record<number, Condition> = {
  0: { sky: "clear", label: "Clear", wet: false },
  1: { sky: "clear", label: "Mostly clear", wet: false },
  2: { sky: "partly", label: "Partly cloudy", wet: false },
  3: { sky: "cloudy", label: "Overcast", wet: false },
  45: { sky: "fog", label: "Fog", wet: false },
  48: { sky: "fog", label: "Freezing fog", wet: false },
  51: { sky: "drizzle", label: "Light drizzle", wet: true },
  53: { sky: "drizzle", label: "Drizzle", wet: true },
  55: { sky: "drizzle", label: "Heavy drizzle", wet: true },
  56: { sky: "drizzle", label: "Freezing drizzle", wet: true },
  57: { sky: "drizzle", label: "Freezing drizzle", wet: true },
  61: { sky: "rain", label: "Light rain", wet: true },
  63: { sky: "rain", label: "Rain", wet: true },
  65: { sky: "rain", label: "Heavy rain", wet: true },
  66: { sky: "rain", label: "Freezing rain", wet: true },
  67: { sky: "rain", label: "Freezing rain", wet: true },
  71: { sky: "snow", label: "Light snow", wet: true },
  73: { sky: "snow", label: "Snow", wet: true },
  75: { sky: "snow", label: "Heavy snow", wet: true },
  77: { sky: "snow", label: "Snow grains", wet: true },
  80: { sky: "rain", label: "Showers", wet: true },
  81: { sky: "rain", label: "Showers", wet: true },
  82: { sky: "rain", label: "Heavy showers", wet: true },
  85: { sky: "snow", label: "Snow showers", wet: true },
  86: { sky: "snow", label: "Snow showers", wet: true },
  95: { sky: "thunder", label: "Thunderstorm", wet: true },
  96: { sky: "thunder", label: "Thunderstorm", wet: true },
  99: { sky: "thunder", label: "Thunderstorm", wet: true },
};

export function condition(code: number): Condition {
  return CONDITIONS[code] ?? { sky: "cloudy", label: "Unsettled", wet: false };
}

const CLOUD = "M7.5 18.5h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2 3.6 3.6 0 0 0 .3 8.2Z";

/**
 * Drawn rather than pulled from an icon set so the weight matches the type and
 * so the panel needs nothing from the network to render.
 */
export function SkyIcon({ sky, isDay = true, size = 28 }: { sky: Sky; isDay?: boolean; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (sky) {
    case "clear":
      return isDay ? (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.2" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line
              key={deg}
              x1={12 + 6.6 * Math.cos((deg * Math.PI) / 180)}
              y1={12 + 6.6 * Math.sin((deg * Math.PI) / 180)}
              x2={12 + 8.8 * Math.cos((deg * Math.PI) / 180)}
              y2={12 + 8.8 * Math.sin((deg * Math.PI) / 180)}
            />
          ))}
        </svg>
      ) : (
        <svg {...common}>
          <path d="M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5Z" />
        </svg>
      );
    case "partly":
      return (
        <svg {...common}>
          <circle cx="8.5" cy="8" r="3" />
          <path d={CLOUD} />
        </svg>
      );
    case "cloudy":
      return (
        <svg {...common}>
          <path d={CLOUD} />
        </svg>
      );
    case "fog":
      return (
        <svg {...common}>
          <path d="M4 9h16M6 13h12M4 17h16" />
        </svg>
      );
    case "drizzle":
      return (
        <svg {...common}>
          <path d="M7.5 15.5h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2 3.6 3.6 0 0 0 .3 8.2Z" />
          <path d="M10 19v1.5M14 19v1.5" />
        </svg>
      );
    case "rain":
      return (
        <svg {...common}>
          <path d="M7.5 15.5h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2 3.6 3.6 0 0 0 .3 8.2Z" />
          <path d="M9 18.5 8 21.5M13 18.5 12 21.5M17 18.5 16 21.5" />
        </svg>
      );
    case "snow":
      return (
        <svg {...common}>
          <path d="M7.5 15.5h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2 3.6 3.6 0 0 0 .3 8.2Z" />
          <path d="M9 19.2v1.6M8.2 20h1.6M15 19.2v1.6M14.2 20h1.6" />
        </svg>
      );
    case "thunder":
      return (
        <svg {...common}>
          <path d="M7.5 14.5h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2 3.6 3.6 0 0 0 .3 8.2Z" />
          <path d="m12.5 16-2.5 4h3l-2 3.5" />
        </svg>
      );
  }
}
