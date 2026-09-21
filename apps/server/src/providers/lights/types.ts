import type { LightsSnapshot } from "@home-dash/shared";

/**
 * What the dashboard needs from a lighting platform, independent of whose
 * bulbs they are. Kasa is the only implementation today; a second platform
 * means a second class, not changes to the widget or the routes.
 */
export interface LightsAdapter {
  read(): Promise<LightsSnapshot>;
  setPower(id: string, on: boolean): Promise<void>;
  setBrightness(id: string, percent: number): Promise<void>;
  setColourTemp(id: string, kelvin: number): Promise<void>;
  setColour(id: string, hue: number, saturation: number): Promise<void>;
}
