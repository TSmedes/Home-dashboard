import type { WeatherSnapshot } from "@home-dash/shared";
import { useNow } from "../../lib/useNow.js";
import { dateKey, dayLabel } from "../../lib/zoned.js";
import type { WidgetProps } from "../types.js";
import { condition, SkyIcon } from "../weatherCodes.js";
import { compass, rangeBar, uvLevel } from "../weatherDetail.js";
import { hourLabel, shortClock, upcoming } from "../weatherTime.js";
import { Section, shown, Stats } from "./parts.js";

const WIND_LABEL: Record<string, string> = { mph: "mph", kmh: "km/h", ms: "m/s", kn: "kn" };

/** Two days of hours, the week and a half ahead, and everything about right now. */
export function WeatherDetail({ config, envelope }: WidgetProps<WeatherSnapshot>) {
  const now = useNow();
  const data = envelope?.data;
  if (!data) return null;

  const { timezone } = config.location;
  const clock = config.units.clock;
  const { units } = data;
  const wind = WIND_LABEL[units.wind] ?? units.wind;
  const rainUnit = units.precipitation ?? (units.temperature === "°F" ? "in" : "mm");
  const sky = condition(data.now.code);
  const hours = upcoming(data.hourly, 48, now, timezone);
  const today = dateKey(now, timezone);
  const days = data.daily.filter((day) => day.date >= today);
  const weekMin = Math.min(...days.map((d) => d.min));
  const weekMax = Math.max(...days.map((d) => d.max));
  const first = days[0];

  return (
    <div className="detail wxd">
      <div className="wxd__now">
        <span className="wxd__icon" style={{ color: sky.wet ? "var(--wet)" : "var(--ink-2)" }}>
          <SkyIcon sky={sky.sky} isDay={data.now.isDay} size={72} />
        </span>
        <div className="wxd__reading">
          <span className="wxd__temp tnum">
            {data.now.temperature}
            <span className="wxd__degree">{units.temperature}</span>
          </span>
          <span className="wxd__label">
            {sky.label} · feels like {data.now.apparentTemperature}°
          </span>
        </div>
      </div>

      <Stats
        items={[
          { label: "Humidity", value: shown(data.now.humidity, "%") },
          {
            label: "Wind",
            value: `${data.now.windSpeed} ${wind}`,
            detail: `from the ${compass(data.now.windDirection)}`,
          },
          {
            label: "UV index",
            value: shown(data.now.uvIndex),
            detail: typeof data.now.uvIndex === "number" ? uvLevel(data.now.uvIndex) : undefined,
          },
          { label: "Rain today", value: typeof first?.precipitationSum === "number" ? `${first.precipitationSum} ${rainUnit}` : "—" },
          { label: "Sunrise", value: first ? shortClock(first.sunrise, clock) : "—" },
          { label: "Sunset", value: first ? shortClock(first.sunset, clock) : "—" },
        ]}
      />

      <Section title="Next 48 hours" className="wxd__hours-section">
        {/* Scrolls sideways; the pager behind is inert while this is open. */}
        <div className="wxd__hours">
          {hours.map((hour) => {
            const midnight = hour.time.slice(11, 13) === "00";
            const hourSky = condition(hour.code);
            return (
              <div className="wxd__hour" key={hour.time} data-midnight={midnight}>
                <span className="wxd__hour-label tnum">
                  {midnight
                    ? new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
                        new Date(`${hour.time.slice(0, 10)}T12:00:00Z`),
                      )
                    : hourLabel(hour.time, clock)}
                </span>
                <span className="wxd__hour-icon" style={{ color: hourSky.wet ? "var(--wet)" : "var(--ink-2)" }}>
                  <SkyIcon sky={hourSky.sky} size={24} />
                </span>
                <span className="wxd__hour-temp tnum">{hour.temperature}°</span>
                <span className="wxd__track">
                  <span className="wxd__bar" style={{ height: `${hour.precipitationProbability}%` }} />
                </span>
                <span className="wxd__hour-rain tnum">{hour.precipitationProbability}%</span>
                <span className="wxd__hour-wind tnum">{shown(hour.windSpeed)}</span>
              </div>
            );
          })}
        </div>
        <p className="wxd__legend">Chance of rain, and wind in {wind}.</p>
      </Section>

      <Section title={`${days.length}-day forecast`} className="wxd__days-section">
        <ul className="wxd__days">
          {days.map((day) => {
            const daySky = condition(day.code);
            const bar = rangeBar(day, weekMin, weekMax);
            return (
              <li className="wxd__day" key={day.date}>
                <span className="wxd__day-name">{dayLabel(day.date, today)}</span>
                <span className="wxd__day-icon" style={{ color: daySky.wet ? "var(--wet)" : "var(--ink-2)" }}>
                  <SkyIcon sky={daySky.sky} size={26} />
                </span>
                <span className="wxd__day-rain tnum" data-wet={day.precipitationProbability >= 20}>
                  {day.precipitationProbability}%
                  {day.precipitationSum > 0 && (
                    <span className="wxd__day-sum">
                      {day.precipitationSum} {rainUnit}
                    </span>
                  )}
                </span>
                <span className="wxd__day-min tnum">{day.min}°</span>
                <span className="wxd__range" aria-hidden="true">
                  <span className="wxd__range-fill" style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
                </span>
                <span className="wxd__day-max tnum">{day.max}°</span>
                <span className="wxd__day-wind tnum">
                  {typeof day.windSpeedMax === "number" ? `${day.windSpeedMax} ${compass(day.windDirection)}` : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
