import type { DashboardConfig } from "@home-dash/shared";
import { KasaLocalAdapter } from "./kasa/local.js";
import type { LightsAdapter } from "./types.js";

/**
 * Stateless: it holds configuration and a transport, nothing more, so the
 * polling source and the control routes can each build their own rather than
 * sharing an instance through the app.
 */
export function createLightsAdapter(config: DashboardConfig): LightsAdapter | null {
  if (config.lights.length === 0) return null;
  // Hidden bulbs are not polled at all, not merely left off the screen.
  return new KasaLocalAdapter(config.lights.filter((light) => !light.hidden));
}

export * from "./types.js";
