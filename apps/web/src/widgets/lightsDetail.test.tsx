import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LightState } from "@home-dash/shared";
import { hueToCss, kelvinToCss, LightsDetail } from "./detail/LightsDetail.js";

const white: LightState = {
  id: "living-room",
  name: "Living Room Light",
  reachable: true,
  on: true,
  brightness: 46,
  colourTemp: 3095,
  hue: 0,
  saturation: 0,
  minKelvin: 2500,
  maxKelvin: 6500,
};

const render = (lights: LightState[]) =>
  renderToStaticMarkup(
    createElement(LightsDetail, {
      envelope: { data: { lights }, fetchedAt: "", stale: false, error: null },
    } as never),
  );

describe("LightsDetail", () => {
  it("shows the warmth slider over the bulb's own range while it is white", () => {
    const html = render([white]);
    expect(html).toContain('aria-label="Living Room Light warmth"');
    expect(html).toMatch(/min="2500" max="6500"/);
    expect(html).toContain("3095K");
    expect(html).not.toContain('aria-label="Red"');
  });

  it("shows swatches, hue and intensity while it is a colour", () => {
    const html = render([{ ...white, colourTemp: 0, hue: 230, saturation: 80 }]);
    expect(html).toContain('aria-label="Blue"');
    expect(html).toMatch(/aria-label="Blue" aria-pressed="true"/);
    expect(html).toContain("230°");
    expect(html).toContain("80%");
    expect(html).not.toContain("warmth");
  });

  it("leaves off presets the bulb cannot make", () => {
    const html = render([{ ...white, maxKelvin: 5000 }]);
    expect(html).toContain("Neutral");
    expect(html).not.toContain("Daylight");
  });
});

describe("swatch colours", () => {
  it("runs warm to cool", () => {
    expect(kelvinToCss(2700)).toBe("rgb(255 167 87)");
    expect(kelvinToCss(6500)).toBe("rgb(255 254 250)");
    expect(hueToCss(230, 100)).toBe("hsl(230 100% 50%)");
  });
});
