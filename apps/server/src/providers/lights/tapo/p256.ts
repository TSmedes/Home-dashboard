/**
 * Just enough NIST P-256 arithmetic for the SPAKE2+ handshake. Node's crypto
 * module does ECDH but will not add arbitrary points or multiply by a scalar
 * we choose, both of which SPAKE2+ needs. Nothing here is constant-time; that
 * is acceptable for a login to a light bulb on the home LAN, not for more.
 */

export const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
export const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const A = P - 3n;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;

export type Point = { x: bigint; y: bigint } | null;

export const G: Point = {
  x: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
  y: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
};

const mod = (value: bigint, m = P): bigint => ((value % m) + m) % m;

function pow(base: bigint, exponent: bigint, m = P): bigint {
  let result = 1n;
  base = mod(base, m);
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exponent >>= 1n;
  }
  return result;
}

/** P is prime, so Fermat gives the inverse. */
const inv = (value: bigint): bigint => pow(value, P - 2n);

export function add(p: Point, q: Point): Point {
  if (!p) return q;
  if (!q) return p;
  if (p.x === q.x) {
    if (mod(p.y + q.y) === 0n) return null;
    const slope = mod((3n * p.x * p.x + A) * inv(2n * p.y));
    const x = mod(slope * slope - 2n * p.x);
    return { x, y: mod(slope * (p.x - x) - p.y) };
  }
  const slope = mod((q.y - p.y) * inv(q.x - p.x));
  const x = mod(slope * slope - p.x - q.x);
  return { x, y: mod(slope * (p.x - x) - p.y) };
}

export const negate = (p: Point): Point => (p ? { x: p.x, y: mod(-p.y) } : null);

export function multiply(p: Point, scalar: bigint): Point {
  let result: Point = null;
  let addend = p;
  let k = mod(scalar, N);
  while (k > 0n) {
    if (k & 1n) result = add(result, addend);
    addend = add(addend, addend);
    k >>= 1n;
  }
  return result;
}

const toHex = (value: bigint): string => value.toString(16).padStart(64, "0");

/** SEC1 uncompressed: 04 || X || Y. */
export function encode(p: Point): Buffer {
  if (!p) throw new Error("cannot encode the point at infinity");
  return Buffer.from(`04${toHex(p.x)}${toHex(p.y)}`, "hex");
}

/** Accepts SEC1 compressed or uncompressed, and checks the point is on the curve. */
export function decode(bytes: Buffer): Point {
  const prefix = bytes[0];
  const x = BigInt(`0x${bytes.subarray(1, 33).toString("hex")}`);
  let y: bigint;
  if (prefix === 0x04 && bytes.length === 65) {
    y = BigInt(`0x${bytes.subarray(33, 65).toString("hex")}`);
  } else if ((prefix === 0x02 || prefix === 0x03) && bytes.length === 33) {
    // P = 3 mod 4, so a square root is a single exponentiation.
    y = pow(mod(x * x * x + A * x + B), (P + 1n) / 4n);
    if ((y & 1n) !== BigInt(prefix & 1)) y = mod(-y);
  } else {
    throw new Error("not a P-256 point");
  }
  if (mod(y * y - (x * x * x + A * x + B)) !== 0n) throw new Error("point is not on P-256");
  return { x, y };
}
