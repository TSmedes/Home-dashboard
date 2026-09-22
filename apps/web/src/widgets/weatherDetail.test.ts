import { describe, expect, it } from "vitest";
import { compass, rangeBar, uvLevel } from "./weatherDetail.js";

describe("compass", () => {
  it("names the eight points the wind comes from", () => {
    expect(compass(0)).toBe("N");
    expect(compass(44)).toBe("NE");
    expect(compass(180)).toBe("S");
    expect(compass(300)).toBe("NW");
  });

  it("wraps round past north", () => {
    expect(compass(350)).toBe("N");
    expect(compass(360)).toBe("N");
    expect(compass(-10)).toBe("N");
  });
});

describe("uvLevel", () => {
  it("uses the WHO bands", () => {
    expect(uvLevel(0)).toBe("Low");
    expect(uvLevel(2.9)).toBe("Low");
    expect(uvLevel(3)).toBe("Moderate");
    expect(uvLevel(6)).toBe("High");
    expect(uvLevel(8)).toBe("Very high");
    expect(uvLevel(11)).toBe("Extreme");
  });
});

describe("rangeBar", () => {
  it("places a day's low and high on the week's scale, as percentages", () => {
    expect(rangeBar({ min: 50, max: 60 }, 40, 80)).toEqual({ left: 25, width: 25 });
  });

  it("spans the whole track for the day that sets both ends", () => {
    expect(rangeBar({ min: 40, max: 80 }, 40, 80)).toEqual({ left: 0, width: 100 });
  });

  it("still draws something for a flat week", () => {
    const bar = rangeBar({ min: 55, max: 55 }, 55, 55);
    expect(bar.left).toBe(0);
    expect(bar.width).toBeGreaterThan(0);
  });
});
