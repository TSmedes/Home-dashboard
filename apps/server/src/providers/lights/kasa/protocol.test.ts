import { describe, expect, it } from "vitest";
import { decrypt, encrypt, frame, isComplete, unframe } from "./protocol.js";

describe("Kasa wire protocol", () => {
  it("round-trips a command through the autokey cipher", () => {
    const text = '{"system":{"get_sysinfo":{}}}';
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it("produces the documented ciphertext for a known plaintext", () => {
    // First byte is '{' (0x7b) XOR the 171 seed.
    expect(encrypt("{")[0]).toBe(0x7b ^ 171);
  });

  it("round-trips text containing non-ASCII characters", () => {
    const text = '{"alias":"Küche – 🏡"}';
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it("prefixes TCP frames with a big-endian payload length", () => {
    const framed = frame('{"a":1}');
    expect(framed.readUInt32BE(0)).toBe(framed.length - 4);
    expect(unframe(framed)).toBe('{"a":1}');
  });

  it("treats a frame as incomplete until the whole payload has arrived", () => {
    const framed = frame('{"system":{"get_sysinfo":{}}}');
    expect(isComplete(framed.subarray(0, 2))).toBe(false);
    expect(isComplete(framed.subarray(0, framed.length - 1))).toBe(false);
    expect(isComplete(framed)).toBe(true);
  });

  it("reassembles a frame split across TCP chunks", () => {
    const framed = frame('{"system":{"get_sysinfo":{}}}');
    const chunks = [framed.subarray(0, 6), framed.subarray(6, 11), framed.subarray(11)];
    let buffer = Buffer.alloc(0);
    for (const chunk of chunks) buffer = Buffer.concat([buffer, chunk]);
    expect(isComplete(buffer)).toBe(true);
    expect(JSON.parse(unframe(buffer))).toEqual({ system: { get_sysinfo: {} } });
  });
});
