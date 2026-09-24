import { describe, expect, it } from "vitest";
import { rememberStart, savedStart, START_KEY } from "./start.js";

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};

describe("start choice", () => {
  it("shows the chooser until something is remembered", () => {
    const store = memory();
    expect(savedStart(store, "")).toBeNull();
    rememberStart(store, "/kiosk/");
    expect(savedStart(store, "")).toBe("/kiosk/");
  });

  it("shows the chooser anyway when asked with ?choose", () => {
    const store = memory();
    rememberStart(store, "/lights/");
    expect(savedStart(store, "?choose")).toBeNull();
    expect(savedStart(store, "?choose=1")).toBeNull();
  });

  it("forgets a choice", () => {
    const store = memory();
    rememberStart(store, "/lights/");
    rememberStart(store, null);
    expect(savedStart(store, "")).toBeNull();
  });

  it("ignores anything that is not one of the apps", () => {
    const store = memory();
    store.setItem(START_KEY, "https://example.com/");
    expect(savedStart(store, "")).toBeNull();
  });

  it("survives storage that is missing or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(savedStart(null, "")).toBeNull();
    expect(savedStart(broken, "")).toBeNull();
    expect(() => rememberStart(broken, "/kiosk/")).not.toThrow();
  });
});
