import type { ConfigChange, LightConfig } from "@home-dash/shared";

/**
 * A bulb as config.yaml would have it written by hand: defaults left out, so
 * moving a Kasa bulb does not suddenly spell out `type: kasa, hidden: false`.
 */
export function asWritten(light: LightConfig): Record<string, string | boolean> {
  return {
    id: light.id,
    name: light.name,
    host: light.host,
    ...(light.type !== "kasa" ? { type: light.type } : {}),
    ...(light.hidden ? { hidden: true } : {}),
  };
}

/**
 * Swap a bulb with its neighbour. Written as two positional replacements in
 * one save: every path in a save is read against the file as it was, so this
 * cannot land half-done or on the wrong entries.
 */
export function moveChanges(lights: LightConfig[], id: string, by: -1 | 1): ConfigChange[] {
  const from = lights.findIndex((light) => light.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= lights.length) return [];
  return [
    { path: ["lights", from], value: asWritten(lights[to]!) },
    { path: ["lights", to], value: asWritten(lights[from]!) },
  ];
}
