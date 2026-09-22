import { describe, expect, it } from "vitest";
import { dayLabel } from "./zoned.js";

describe("dayLabel", () => {
  // 2026-09-21 is a Monday.
  it("says today, tomorrow, then the weekday for the week ahead", () => {
    expect(dayLabel("2026-09-21", "2026-09-21")).toBe("Today");
    expect(dayLabel("2026-09-22", "2026-09-21")).toBe("Tomorrow");
    expect(dayLabel("2026-09-25", "2026-09-21")).toBe("Friday");
    expect(dayLabel("2026-09-27", "2026-09-21")).toBe("Sunday");
  });

  it("gives a short date from a week out", () => {
    expect(dayLabel("2026-09-28", "2026-09-21")).toBe("Sep 28");
    expect(dayLabel("2026-12-20", "2026-09-21")).toBe("Dec 20");
  });
});
