import { describe, expect, it } from "vitest";
import type { WidgetInstance } from "@home-dash/shared";
import { clampOption, optionValue, setOption, type OptionSpec } from "./options.js";

const hours: OptionSpec = { key: "hours", kind: "number", label: "Hours", default: 8, min: 3, max: 24 };
const compact: OptionSpec = { key: "compact", kind: "boolean", label: "Compact", default: false };
const size: OptionSpec = {
  key: "size",
  kind: "enum",
  label: "Size",
  default: "default",
  choices: [{ value: "default", label: "Normal" }, { value: "xl", label: "Extra large" }],
};

const widget = (options: Record<string, unknown>): WidgetInstance => ({
  id: "weather",
  type: "weather",
  enabled: true,
  page: 1,
  options,
  grid: { col: 1, row: 1, colSpan: 4, rowSpan: 2, share: false },
});

const optionsOf = (widgets: WidgetInstance[]) => widgets[0]!.options;

describe("optionValue", () => {
  it("reads the value the widget was given", () => {
    expect(optionValue(hours, { hours: 12 })).toBe(12);
    expect(optionValue(compact, { compact: true })).toBe(true);
    expect(optionValue(size, { size: "xl" })).toBe("xl");
  });

  it("falls back to the default when nothing is set", () => {
    expect(optionValue(hours, {})).toBe(8);
    expect(optionValue(compact, {})).toBe(false);
    expect(optionValue(size, {})).toBe("default");
  });

  // config.yaml is hand-edited, so the wrong type in it must not reach a widget
  // as the wrong type - it reads as "not set".
  it("ignores a value of the wrong kind", () => {
    expect(optionValue(hours, { hours: "twelve" })).toBe(8);
    expect(optionValue(compact, { compact: "yes" })).toBe(false);
  });

  it("ignores a choice the widget does not offer", () => {
    expect(optionValue(size, { size: "enormous" })).toBe("default");
  });
});

describe("clampOption", () => {
  it("keeps a number inside what the widget can use", () => {
    expect(clampOption(hours, 100)).toBe(24);
    expect(clampOption(hours, 0)).toBe(3);
    expect(clampOption(hours, 10)).toBe(10);
  });
});

describe("setOption", () => {
  it("writes a value that differs from the default", () => {
    expect(optionsOf(setOption([widget({})], "weather", hours, 12))).toEqual({ hours: 12 });
  });

  it("drops the key when the value is back to normal", () => {
    // Writing `hours: 8` would be a line saying what would have happened anyway.
    expect(optionsOf(setOption([widget({ hours: 12 })], "weather", hours, 8))).toEqual({});
  });

  it("leaves the widget's other options alone", () => {
    const next = setOption([widget({ hours: 12, compact: true })], "weather", hours, 6);
    expect(optionsOf(next)).toEqual({ hours: 6, compact: true });
  });

  it("leaves other widgets alone", () => {
    const other = { ...widget({}), id: "other" };
    const next = setOption([widget({}), other], "weather", hours, 6);
    expect(next[1]).toBe(other);
  });
});
