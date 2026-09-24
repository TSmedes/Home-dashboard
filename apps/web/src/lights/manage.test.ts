import { describe, expect, it } from "vitest";
import type { LightConfig } from "@home-dash/shared";
import { asWritten, moveChanges } from "./manage.js";

const lights: LightConfig[] = [
  { id: "a", name: "A", host: "10.0.0.1", type: "kasa", hidden: false },
  { id: "b", name: "B", host: "10.0.0.2", type: "tapo", hidden: true },
  { id: "c", name: "C", host: "10.0.0.3", type: "kasa", hidden: false },
];

describe("managing bulbs", () => {
  it("writes a bulb without its defaults", () => {
    expect(asWritten(lights[0]!)).toEqual({ id: "a", name: "A", host: "10.0.0.1" });
    expect(asWritten(lights[1]!)).toEqual({ id: "b", name: "B", host: "10.0.0.2", type: "tapo", hidden: true });
  });

  it("swaps a bulb with the one above or below it", () => {
    expect(moveChanges(lights, "b", -1)).toEqual([
      { path: ["lights", 1], value: asWritten(lights[0]!) },
      { path: ["lights", 0], value: asWritten(lights[1]!) },
    ]);
    expect(moveChanges(lights, "b", 1).map((change) => change.path)).toEqual([
      ["lights", 1],
      ["lights", 2],
    ]);
  });

  it("does nothing past either end, or for a bulb it does not know", () => {
    expect(moveChanges(lights, "a", -1)).toEqual([]);
    expect(moveChanges(lights, "c", 1)).toEqual([]);
    expect(moveChanges(lights, "zzz", 1)).toEqual([]);
  });
});
