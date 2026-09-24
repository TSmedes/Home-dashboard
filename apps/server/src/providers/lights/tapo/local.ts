import type { LightConfig, LightsSnapshot, LightState } from "@home-dash/shared";
import { clamp, unreachable } from "../kasa/local.js";
import type { LightsAdapter } from "../types.js";
import { type Credentials, httpPost, login, type Post, request, type Session, TapoError } from "./tpap.js";

/** L531E range. A bulb that reports its own range overrides it. */
export const MIN_KELVIN = 2500;
export const MAX_KELVIN = 6500;

export interface TapoDeviceInfo {
  device_on?: boolean;
  brightness?: number;
  color_temp?: number;
  color_temp_range?: [number, number];
  hue?: number;
  saturation?: number;
}

/** Unlike Kasa, a Tapo bulb reports its settings whether it is on or off. */
export function mapDeviceInfo(config: LightConfig, info: TapoDeviceInfo): LightState {
  return {
    id: config.id,
    name: config.name,
    reachable: true,
    on: info.device_on === true,
    brightness: info.brightness ?? 0,
    colourTemp: info.color_temp ?? 0,
    hue: info.hue ?? 0,
    saturation: info.saturation ?? 0,
    minKelvin: info.color_temp_range?.[0] ?? MIN_KELVIN,
    maxKelvin: info.color_temp_range?.[1] ?? MAX_KELVIN,
  };
}

/**
 * Logging in costs three round trips and a PBKDF2, so a session outlives the
 * adapter: the poller and the control routes each build their own adapter,
 * but share whatever session a bulb already has. Requests to one bulb are
 * queued, since each carries the next number in the session's sequence.
 */
const sessions = new Map<string, Promise<Session>>();
const queues = new Map<string, Promise<unknown>>();
/** Colour temperature limits, as each bulb last reported them. */
const ranges = new Map<string, [number, number]>();

/** For tests. */
export function forgetSessions(): void {
  sessions.clear();
  queues.clear();
  ranges.clear();
}

export class TapoLocalAdapter implements LightsAdapter {
  readonly #lights: LightConfig[];
  readonly #creds: Credentials | null;
  readonly #post: Post;

  constructor(lights: LightConfig[], creds: Credentials | null, post: Post = httpPost()) {
    this.#lights = lights;
    this.#creds = creds;
    this.#post = post;
  }

  async read(): Promise<LightsSnapshot> {
    const results = await Promise.all(
      this.#lights.map(async (config) => {
        try {
          const info = (await this.#call(config, "get_device_info", null)) as TapoDeviceInfo;
          if (info.color_temp_range) ranges.set(config.host, info.color_temp_range);
          return mapDeviceInfo(config, info);
        } catch {
          return unreachable(config);
        }
      }),
    );
    return { lights: results };
  }

  async setPower(id: string, on: boolean): Promise<void> {
    await this.#set(id, { device_on: on });
  }

  async setBrightness(id: string, percent: number): Promise<void> {
    await this.#set(id, { device_on: true, brightness: clamp(percent, 1, 100) });
  }

  async setColourTemp(id: string, kelvin: number): Promise<void> {
    const host = this.#lights.find((light) => light.id === id)?.host ?? "";
    const [min, max] = ranges.get(host) ?? [MIN_KELVIN, MAX_KELVIN];
    await this.#set(id, { device_on: true, color_temp: clamp(kelvin, min, max) });
  }

  async setColour(id: string, hue: number, saturation: number): Promise<void> {
    // As with Kasa, a non-zero colour temperature keeps the bulb in white mode.
    await this.#set(id, {
      device_on: true,
      color_temp: 0,
      hue: clamp(hue, 0, 360),
      saturation: clamp(saturation, 0, 100),
    });
  }

  async #set(id: string, params: Record<string, unknown>): Promise<void> {
    const config = this.#lights.find((light) => light.id === id);
    if (!config) throw new TapoError(id, "no light with that id in config.yaml");
    await this.#call(config, "set_device_info", params);
  }

  #call(config: LightConfig, method: string, params: object | null): Promise<Record<string, unknown>> {
    const { host } = config;
    const run = async () => {
      try {
        return await request(host, await this.#session(host), method, params, this.#post);
      } catch {
        // Bulbs drop sessions when they reboot or after a while idle; one
        // fresh login is worth trying before calling the bulb unreachable.
        sessions.delete(host);
        return await request(host, await this.#session(host), method, params, this.#post);
      }
    };
    const queued = (queues.get(host) ?? Promise.resolve()).then(run, run);
    queues.set(host, queued.catch(() => undefined));
    return queued;
  }

  #session(host: string): Promise<Session> {
    if (!this.#creds) {
      return Promise.reject(new TapoError(host, "needs TAPO_USERNAME and TAPO_PASSWORD in .env"));
    }
    let session = sessions.get(host);
    if (!session) {
      session = login(host, this.#creds, this.#post);
      sessions.set(host, session);
      session.catch(() => sessions.delete(host));
    }
    return session;
  }
}
