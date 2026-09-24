import { describe, expect, it } from "vitest";
import { entryFor } from "./webEntries.js";

describe("entryFor", () => {
  it("sends each app's paths to its own page", () => {
    expect(entryFor("/kiosk/")).toBe("kiosk/index.html");
    expect(entryFor("/kiosk/settings?x=1")).toBe("kiosk/index.html");
    expect(entryFor("/lights")).toBe("lights/index.html");
    expect(entryFor("/lights/anything")).toBe("lights/index.html");
  });

  it("sends everything else to the chooser", () => {
    expect(entryFor("/")).toBe("index.html");
    expect(entryFor("/?choose")).toBe("index.html");
    expect(entryFor("/kiosky")).toBe("index.html");
    expect(entryFor("/lightsaber")).toBe("index.html");
  });

  it("never answers an API path with a page", () => {
    expect(entryFor("/api/nope")).toBe("api");
    expect(entryFor("/api")).toBe("api");
  });
});
