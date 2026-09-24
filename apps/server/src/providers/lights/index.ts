import type { DashboardConfig, LightsSnapshot } from "@home-dash/shared";
import type { Env } from "../../env.js";
import { KasaLocalAdapter } from "./kasa/local.js";
import { TapoLocalAdapter } from "./tapo/local.js";
import type { LightsAdapter } from "./types.js";

/**
 * Stateless: it holds configuration and a transport, nothing more, so the
 * polling source and the control routes can each build their own rather than
 * sharing an instance through the app. (Tapo login sessions are cached below
 * it, in the Tapo adapter's module.)
 */
export function createLightsAdapter(
  config: DashboardConfig,
  env: Pick<Env, "TAPO_USERNAME" | "TAPO_PASSWORD">,
): LightsAdapter | null {
  if (config.lights.length === 0) return null;
  // Hidden bulbs are not polled at all, not merely left off the screen.
  const lights = config.lights.filter((light) => !light.hidden);
  const creds = env.TAPO_PASSWORD ? { username: env.TAPO_USERNAME ?? "", password: env.TAPO_PASSWORD } : null;
  return new MixedLightsAdapter(
    lights.map((light) => light.id),
    new KasaLocalAdapter(lights.filter((light) => light.type === "kasa")),
    new TapoLocalAdapter(lights.filter((light) => light.type === "tapo"), creds),
    new Set(lights.filter((light) => light.type === "tapo").map((light) => light.id)),
  );
}

/** Sends each command to whichever platform the bulb is on, and reads both in config order. */
export class MixedLightsAdapter implements LightsAdapter {
  constructor(
    readonly order: string[],
    readonly kasa: LightsAdapter,
    readonly tapo: LightsAdapter,
    readonly tapoIds: Set<string>,
  ) {}

  async read(): Promise<LightsSnapshot> {
    const [kasa, tapo] = await Promise.all([this.kasa.read(), this.tapo.read()]);
    const all = [...kasa.lights, ...tapo.lights];
    return { lights: this.order.flatMap((id) => all.filter((light) => light.id === id)) };
  }

  #for(id: string): LightsAdapter {
    return this.tapoIds.has(id) ? this.tapo : this.kasa;
  }

  setPower(id: string, on: boolean) {
    return this.#for(id).setPower(id, on);
  }
  setBrightness(id: string, percent: number) {
    return this.#for(id).setBrightness(id, percent);
  }
  setColourTemp(id: string, kelvin: number) {
    return this.#for(id).setColourTemp(id, kelvin);
  }
  setColour(id: string, hue: number, saturation: number) {
    return this.#for(id).setColour(id, hue, saturation);
  }
}

export * from "./types.js";
