import { describe, expect, it, vi } from "vitest";
import type { LightConfig } from "@home-dash/shared";
import { clamp, KasaLocalAdapter, mapSysinfo, type KasaSysinfo } from "./local.js";

const bulb: LightConfig = { id: "front", name: "Front door light", host: "10.0.0.147" };

// Recorded from a real KL135 on firmware 1.0.15, switched off at the time.
const OFF: KasaSysinfo = {
  alias: "Front door light",
  model: "KL135(US)",
  light_state: {
    on_off: 0,
    dft_on_state: { mode: "normal", hue: 0, saturation: 0, color_temp: 4510, brightness: 67 },
  },
};

const ON: KasaSysinfo = {
  alias: "Front door light",
  model: "KL135(US)",
  light_state: { on_off: 1, mode: "normal", hue: 0, saturation: 0, color_temp: 2700, brightness: 45 },
};

describe("mapSysinfo", () => {
  it("reads settings from light_state when the bulb is on", () => {
    expect(mapSysinfo(bulb, ON)).toEqual({
      id: "front",
      name: "Front door light",
      reachable: true,
      on: true,
      brightness: 45,
      colourTemp: 2700,
      hue: 0,
      saturation: 0,
      minKelvin: 2500,
      maxKelvin: 9000,
    });
  });

  // Reading brightness straight off light_state would report 0 for every bulb
  // that happens to be off, giving the wall a row of dead sliders.
  it("falls back to dft_on_state when the bulb is off", () => {
    const state = mapSysinfo(bulb, OFF);
    expect(state.on).toBe(false);
    expect(state.brightness).toBe(67);
    expect(state.colourTemp).toBe(4510);
  });

  it("prefers the configured name over the bulb's own alias", () => {
    expect(mapSysinfo({ ...bulb, name: "Porch" }, ON).name).toBe("Porch");
  });

  it("copes with a bulb that reports no light_state at all", () => {
    const state = mapSysinfo(bulb, { alias: "x" });
    expect(state.on).toBe(false);
    expect(state.brightness).toBe(0);
    expect(state.reachable).toBe(true);
  });
});

describe("clamp", () => {
  it.each([
    [150, 1, 100, 100],
    [-5, 1, 100, 1],
    [50.6, 1, 100, 51],
  ])("clamps %s into [%s, %s] as %s", (value, min, max, expected) => {
    expect(clamp(value, min, max)).toBe(expected);
  });
});

describe("KasaLocalAdapter", () => {
  const sysinfoReply = (info: KasaSysinfo) => ({ system: { get_sysinfo: info } });
  const ok = { "smartlife.iot.smartbulb.lightingservice": { transition_light_state: { err_code: 0 } } };

  it("reads every configured bulb", async () => {
    const transport = vi.fn(async () => sysinfoReply(ON));
    const adapter = new KasaLocalAdapter([bulb, { ...bulb, id: "back", host: "10.0.0.148" }], transport);

    const snapshot = await adapter.read();
    expect(snapshot.lights).toHaveLength(2);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  // A bulb switched off at the wall is unreachable, not a reason to blank the widget.
  it("degrades an unreachable bulb without failing the others", async () => {
    const transport = vi.fn(async (host: string) => {
      if (host === "10.0.0.148") throw new Error("ETIMEDOUT");
      return sysinfoReply(ON);
    });
    const adapter = new KasaLocalAdapter([bulb, { id: "back", name: "Back", host: "10.0.0.148" }], transport);

    const snapshot = await adapter.read();
    expect(snapshot.lights[0]).toMatchObject({ id: "front", reachable: true, on: true });
    expect(snapshot.lights[1]).toMatchObject({ id: "back", reachable: false });
  });

  it("sends a power command for the matching bulb only", async () => {
    const transport = vi.fn(async () => ok);
    await new KasaLocalAdapter([bulb], transport).setPower("front", true);

    expect(transport).toHaveBeenCalledWith("10.0.0.147", {
      "smartlife.iot.smartbulb.lightingservice": {
        transition_light_state: { ignore_default: 1, on_off: 1 },
      },
    });
  });

  it("turns the bulb on when setting brightness, and never sends zero", async () => {
    const transport = vi.fn(async () => ok);
    const adapter = new KasaLocalAdapter([bulb], transport);

    await adapter.setBrightness("front", 0);
    const sent = transport.mock.calls[0]![1] as Record<string, { transition_light_state: Record<string, number> }>;
    const state = sent["smartlife.iot.smartbulb.lightingservice"]!.transition_light_state;
    expect(state.brightness).toBe(1);
    expect(state.on_off).toBe(1);
  });

  it("zeroes colour temperature when setting a colour, or the bulb stays white", async () => {
    const transport = vi.fn(async () => ok);
    await new KasaLocalAdapter([bulb], transport).setColour("front", 120, 100);

    const sent = transport.mock.calls[0]![1] as Record<string, { transition_light_state: Record<string, number> }>;
    expect(sent["smartlife.iot.smartbulb.lightingservice"]!.transition_light_state).toMatchObject({
      color_temp: 0,
      hue: 120,
      saturation: 100,
    });
  });

  it("clamps colour temperature to the range the KL135 accepts", async () => {
    const transport = vi.fn(async () => ok);
    await new KasaLocalAdapter([bulb], transport).setColourTemp("front", 99_000);

    const sent = transport.mock.calls[0]![1] as Record<string, { transition_light_state: Record<string, number> }>;
    expect(sent["smartlife.iot.smartbulb.lightingservice"]!.transition_light_state!.color_temp).toBe(9000);
  });

  it("reports an unknown light id rather than silently doing nothing", async () => {
    const adapter = new KasaLocalAdapter([bulb], vi.fn(async () => ok));
    await expect(adapter.setPower("kitchen", true)).rejects.toThrow(/no light with that id/);
  });

  it("surfaces a rejection from the bulb", async () => {
    const transport = vi.fn(async () => ({
      "smartlife.iot.smartbulb.lightingservice": { transition_light_state: { err_code: -3 } },
    }));
    await expect(new KasaLocalAdapter([bulb], transport).setPower("front", true)).rejects.toThrow(/err_code -3/);
  });
});
