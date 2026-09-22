import { describe, expect, it } from "vitest";
import { clipInset } from "./expandGeometry.js";

const shell = { top: 14, left: 14, width: 1000, height: 700 };

describe("clipInset", () => {
  it("clips the full-screen shell down to where the tile sits", () => {
    const tile = { top: 114, left: 214, width: 300, height: 200 };
    expect(clipInset(tile, shell, 32)).toBe("inset(100px 500px 400px 200px round 32px)");
  });

  it("is no clip at all when the box is the shell itself", () => {
    expect(clipInset(shell, shell, 32)).toBe("inset(0px 0px 0px 0px round 32px)");
  });

  it("never clips outwards when the tile pokes past the shell's edge", () => {
    const tile = { top: 0, left: 0, width: 1100, height: 300 };
    expect(clipInset(tile, shell, 32)).toBe("inset(0px 0px 414px 0px round 32px)");
  });

  it("rounds to a tenth of a pixel so the string stays short", () => {
    const tile = { top: 14.333, left: 14.666, width: 500, height: 300 };
    expect(clipInset(tile, shell, 20)).toBe("inset(0.3px 499.3px 399.7px 0.7px round 20px)");
  });
});
