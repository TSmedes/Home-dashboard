import type { LightConfig, LightsSnapshot, LightState } from "@home-dash/shared";
import type { LightsAdapter } from "../types.js";
import { KasaError, send } from "./protocol.js";

const LIGHTING_SERVICE = "smartlife.iot.smartbulb.lightingservice";

/** KL135 accepts 2500-9000K; anything outside is silently ignored by the bulb. */
export const MIN_KELVIN = 2500;
export const MAX_KELVIN = 9000;

export interface KasaLightState {
  on_off: 0 | 1;
  mode?: string;
  hue?: number;
  saturation?: number;
  color_temp?: number;
  brightness?: number;
  /** Present when the bulb is off: the settings it will return to. */
  dft_on_state?: {
    mode?: string;
    hue?: number;
    saturation?: number;
    color_temp?: number;
    brightness?: number;
  };
}

export interface KasaSysinfo {
  alias?: string;
  model?: string;
  light_state?: KasaLightState;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

/**
 * A bulb that is switched off reports its settings under `dft_on_state` rather
 * than on `light_state` itself - so reading brightness straight off
 * `light_state` yields zero for every light that happens to be off, and the
 * dashboard would show a row of dead sliders.
 */
export function mapSysinfo(config: LightConfig, sysinfo: KasaSysinfo): LightState {
  const light = sysinfo.light_state ?? { on_off: 0 };
  const on = light.on_off === 1;
  const active = on ? light : (light.dft_on_state ?? {});

  return {
    id: config.id,
    name: config.name || sysinfo.alias || config.id,
    reachable: true,
    on,
    brightness: active.brightness ?? 0,
    colourTemp: active.color_temp ?? 0,
    hue: active.hue ?? 0,
    saturation: active.saturation ?? 0,
  };
}

/** A bulb we could not reach. Shown greyed out rather than removed from the wall. */
export function unreachable(config: LightConfig): LightState {
  return {
    id: config.id,
    name: config.name,
    reachable: false,
    on: false,
    brightness: 0,
    colourTemp: 0,
    hue: 0,
    saturation: 0,
  };
}

type Transport = (host: string, command: unknown) => Promise<unknown>;

export class KasaLocalAdapter implements LightsAdapter {
  readonly #lights: LightConfig[];
  readonly #send: Transport;

  constructor(lights: LightConfig[], transport: Transport = (host, cmd) => send(host, cmd)) {
    this.#lights = lights;
    this.#send = transport;
  }

  /**
   * One slow or unplugged bulb must not hide the others, so every bulb is
   * queried in parallel and failures degrade to an unreachable tile.
   */
  async read(): Promise<LightsSnapshot> {
    const results = await Promise.all(
      this.#lights.map(async (config) => {
        try {
          const response = (await this.#send(config.host, { system: { get_sysinfo: {} } })) as {
            system?: { get_sysinfo?: KasaSysinfo };
          };
          const sysinfo = response?.system?.get_sysinfo;
          return sysinfo ? mapSysinfo(config, sysinfo) : unreachable(config);
        } catch {
          return unreachable(config);
        }
      }),
    );
    return { lights: results };
  }

  async setPower(id: string, on: boolean): Promise<void> {
    await this.#transition(id, { on_off: on ? 1 : 0 });
  }

  async setBrightness(id: string, percent: number): Promise<void> {
    // Zero brightness is not "off" to a Kasa bulb, it is an invalid value.
    await this.#transition(id, { on_off: 1, brightness: clamp(percent, 1, 100) });
  }

  async setColourTemp(id: string, kelvin: number): Promise<void> {
    await this.#transition(id, {
      on_off: 1,
      color_temp: clamp(kelvin, MIN_KELVIN, MAX_KELVIN),
      saturation: 0,
    });
  }

  async setColour(id: string, hue: number, saturation: number): Promise<void> {
    // color_temp must be zeroed or the bulb stays in white mode and ignores hue.
    await this.#transition(id, {
      on_off: 1,
      color_temp: 0,
      hue: clamp(hue, 0, 360),
      saturation: clamp(saturation, 0, 100),
    });
  }

  async #transition(id: string, state: Record<string, number>): Promise<void> {
    const config = this.#lights.find((light) => light.id === id);
    if (!config) throw new KasaError(id, "no light with that id in config.yaml");

    const response = (await this.#send(config.host, {
      [LIGHTING_SERVICE]: { transition_light_state: { ignore_default: 1, ...state } },
    })) as Record<string, { transition_light_state?: { err_code?: number } }>;

    const errCode = response?.[LIGHTING_SERVICE]?.transition_light_state?.err_code;
    if (errCode !== undefined && errCode !== 0) {
      throw new KasaError(config.host, `rejected the command (err_code ${errCode})`);
    }
  }
}
