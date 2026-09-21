import type { WeatherSnapshot } from "@home-dash/shared";
import type { WidgetProps } from "./types.js";
import { condition, SkyIcon } from "./weatherCodes.js";
import { hourLabel, shortClock, upcoming } from "./weatherTime.js";

interface WeatherOptions {
  compact?: boolean;
  hours?: number;
}

export function WeatherWidget({ instance, config, envelope }: WidgetProps<WeatherSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;

  const options = instance.options as WeatherOptions;
  const compact = options.compact ?? false;
  const clock = config.units.clock;
  const { now, daily, units } = data;
  const sky = condition(now.code);
  const today = daily[0];
  const hours = upcoming(data.hourly, options.hours ?? 8, new Date(), config.location.timezone);
  const wettest = hours.reduce((max, h) => Math.max(max, h.precipitationProbability), 0);

  return (
    <div className={compact ? "weather weather--compact" : "weather"}>
      <div className="weather__now">
        <span className="weather__icon" style={{ color: sky.wet ? "var(--wet)" : "var(--ink-2)" }}>
          <SkyIcon sky={sky.sky} isDay={now.isDay} size={compact ? 30 : 44} />
        </span>
        <div className="weather__reading">
          <span className="weather__temp tnum">
            {now.temperature}
            <span className="weather__degree">{units.temperature}</span>
          </span>
          <span className="weather__label">{sky.label}</span>
        </div>
        {today && (
          <dl className="weather__range tnum">
            <div>
              <dt>High</dt>
              <dd>{today.max}</dd>
            </div>
            <div>
              <dt>Low</dt>
              <dd>{today.min}</dd>
            </div>
            <div>
              <dt>Feels</dt>
              <dd>{now.apparentTemperature}</dd>
            </div>
          </dl>
        )}
      </div>

      {!compact && hours.length > 0 && (
        <>
          {/* Leads with rain probability rather than temperature: in the Cascade
              foothills that is the question actually being asked. Each bar sits
              in a track so an empty one reads as "no rain" rather than as a
              missing bar. */}
          <div className="weather__strip">
            {hours.map((hour) => (
              <div className="weather__hour" key={hour.time}>
                <span className="weather__hour-temp tnum">{hour.temperature}</span>
                <span className="weather__track">
                  <span
                    className="weather__bar"
                    style={{ height: `${hour.precipitationProbability}%` }}
                  />
                </span>
                <span className="weather__hour-label tnum">{hourLabel(hour.time, clock)}</span>
              </div>
            ))}
          </div>

          <p className="weather__summary">
            <span>
              {wettest >= 20 ? (
                <>
                  Rain reaching <strong className="weather__chance">{wettest}%</strong> by{" "}
                  {hourLabel(
                    hours.find((h) => h.precipitationProbability === wettest)?.time ?? hours[0]!.time,
                    clock,
                  )}
                </>
              ) : (
                <>Dry for the next {hours.length} hours</>
              )}
            </span>
            {today && (
              <span className="weather__sun tnum">
                {shortClock(today.sunrise, clock)} – {shortClock(today.sunset, clock)}
              </span>
            )}
          </p>
        </>
      )}
    </div>
  );
}
