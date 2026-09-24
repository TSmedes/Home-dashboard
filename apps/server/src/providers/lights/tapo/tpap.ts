import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { request as httpRequest } from "node:http";
import { add, decode, encode, G, multiply, N, negate, type Point } from "./p256.js";

/**
 * TP-Link's newest local protocol, "TPAP", which Tapo firmware from 2025 on
 * speaks in place of KLAP. Login is a SPAKE2+ exchange over plain HTTP, keyed
 * by the TP-Link account password; every request after that is AES-128-CCM
 * with a sequence number folded into the nonce.
 *
 * Worked out from python-kasa's implementation (PR #1592). Only what bulbs
 * use is here: the password login, cipher suite 1 (P-256, SHA-256, HMAC) and
 * AES-128-CCM. Cameras and vacuums take other branches of the same protocol.
 */

/** The standard SPAKE2+ P-256 M and N points (RFC 9383). */
const M = decode(Buffer.from("02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f", "hex"));
const N_POINT = decode(Buffer.from("03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49", "hex"));

const KEY_SALT = "tp-kdf-salt-aes128-key";
const KEY_INFO = "tp-kdf-info-aes128-key";
const NONCE_SALT = "tp-kdf-salt-aes128-iv";
const NONCE_INFO = "tp-kdf-info-aes128-iv";
const TAG_LENGTH = 16;

export class TapoError extends Error {
  constructor(
    readonly host: string,
    message: string,
  ) {
    super(`${host}: ${message}`);
    this.name = "TapoError";
  }
}

export interface Credentials {
  username: string;
  password: string;
}

export interface HttpReply {
  status: number;
  body: Buffer;
}

/** POSTs JSON (an object) or raw bytes (a Buffer). Swapped out in tests. */
export type Post = (url: string, body: object | Buffer) => Promise<HttpReply>;

/**
 * node:http rather than fetch: the bulb's web server matches "Content-Length"
 * case-sensitively, and fetch sends it lower-cased, so the bulb sees no body
 * and answers every request with a stock "200 OK" page.
 */
export const httpPost =
  (timeoutMs = 5000): Post =>
  (url, body) =>
    new Promise((resolve, reject) => {
      const raw = Buffer.isBuffer(body);
      const payload = raw ? body : Buffer.from(JSON.stringify(body));
      const req = httpRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": raw ? "application/octet-stream" : "application/json",
          "Content-Length": String(payload.length),
        },
        timeout: timeoutMs,
      });
      req.on("timeout", () => req.destroy(new Error("timed out; is the bulb powered on?")));
      req.on("error", reject);
      req.on("response", (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      });
      req.end(payload);
    });

const sha256 = (data: Buffer): Buffer => createHash("sha256").update(data).digest();
const hex = (algorithm: string, text: string): string => createHash(algorithm).update(text).digest("hex");
const hkdf = (ikm: Buffer, salt: Buffer | string, info: string, length: number): Buffer =>
  Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
const toBigInt = (bytes: Buffer): bigint => BigInt(`0x${bytes.toString("hex") || "0"}`);
const len8le = (bytes: Buffer): Buffer => {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(bytes.length));
  return Buffer.concat([prefix, bytes]);
};

/**
 * w0 as the device hashes it into the transcript: minimal big-endian bytes,
 * with a zero byte in front only when the length is odd and the top bit set.
 * An oddity of TP-Link's, not of SPAKE2+, but the confirmation fails without it.
 */
export function encodeW(value: bigint): Buffer {
  let text = value.toString(16);
  if (text.length % 2) text = `0${text}`;
  const bytes = Buffer.from(text, "hex");
  if (bytes.length % 2 === 0) return bytes;
  return bytes[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
}

/** The two SPAKE2+ scalars, from PBKDF2 over whatever the device asked us to hash the password into. */
export function deriveScalars(secret: string, salt: Buffer, iterations: number): { w0: bigint; w1: bigint } {
  const derived = pbkdf2Sync(secret, salt, iterations, 80, "sha256");
  return { w0: toBigInt(derived.subarray(0, 40)) % N, w1: toBigInt(derived.subarray(40)) % N };
}

interface ExtraCrypt {
  type?: string;
  params?: Record<string, unknown>;
}

/**
 * The device does not hold the password itself, only a hash of it, and says
 * in its register reply which hash. A bulb on the TP-Link cloud has so far
 * always asked for SHA-1 (password_shadow, passwd_id 2).
 */
export function passcodeFor(extra: ExtraCrypt | undefined, creds: Credentials, mac: string): string {
  const { username, password } = creds;
  if (!extra?.type) return username ? `${username}/${password}` : password;
  const params = extra.params ?? {};

  if (extra.type === "password_shadow") {
    const id = Number(params.passwd_id);
    if (id === 2) return hex("sha1", password);
    if (id === 3 && username && mac.length === 12) {
      const colons = mac.match(/../g)!.join(":").toUpperCase();
      return hex("sha1", `${hex("md5", username)}_${colons}`);
    }
    throw new Error(`asks for password hash type ${id}, which is not supported yet`);
  }
  if (extra.type === "password_sha_with_salt") {
    const who = Number(params.sha_name) === 0 ? "admin" : "user";
    const salt = Buffer.from(String(params.sha_salt ?? ""), "base64").toString();
    return hex("sha256", `${who}${salt}${password}`);
  }
  throw new Error(`asks for a "${extra.type}" password, which is not supported yet`);
}

export interface Session {
  url: string;
  key: Buffer;
  nonce: Buffer;
  sequence: number;
}

function nonceFor(base: Buffer, sequence: number): Buffer {
  const nonce = Buffer.from(base);
  nonce.writeUInt32BE(sequence, nonce.length - 4);
  return nonce;
}

export function seal(key: Buffer, base: Buffer, sequence: number, plaintext: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ccm", key, nonceFor(base, sequence), { authTagLength: TAG_LENGTH });
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
}

export function open(key: Buffer, base: Buffer, sequence: number, sealed: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ccm", key, nonceFor(base, sequence), { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LENGTH));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_LENGTH)), decipher.final()]);
}

export function sessionKeys(shared: Buffer): { key: Buffer; nonce: Buffer } {
  return { key: hkdf(shared, KEY_SALT, KEY_INFO, 16), nonce: hkdf(shared, NONCE_SALT, NONCE_INFO, 12) };
}

/** Everything both sides hash, in the order and framing TP-Link chose. */
export function transcriptHash(parts: {
  userRandom: Buffer;
  devRandom: Buffer;
  share: Point;
  devShare: Point;
  z: Point;
  v: Point;
  w0: bigint;
}): Buffer {
  const context = sha256(Buffer.concat([Buffer.from("PAKE V1"), parts.userRandom, parts.devRandom]));
  return sha256(
    Buffer.concat(
      [
        context,
        Buffer.alloc(0),
        Buffer.alloc(0),
        encode(M),
        encode(N_POINT),
        encode(parts.share),
        encode(parts.devShare),
        encode(parts.z),
        encode(parts.v),
        encodeW(parts.w0),
      ].map(len8le),
    ),
  );
}

export function confirmations(transcript: Buffer, share: Buffer, devShare: Buffer) {
  const zeroSalt = Buffer.alloc(32);
  const keys = hkdf(transcript, zeroSalt, "ConfirmationKeys", 64);
  return {
    user: createHmac("sha256", keys.subarray(0, 32)).update(devShare).digest(),
    device: createHmac("sha256", keys.subarray(32)).update(share).digest(),
    shared: hkdf(transcript, zeroSalt, "SharedKey", 32),
  };
}

async function postJson(post: Post, host: string, url: string, body: object): Promise<Record<string, unknown>> {
  const reply = await post(url, body);
  if (reply.status !== 200) throw new TapoError(host, `answered ${reply.status}`);
  const json = JSON.parse(reply.body.toString()) as { error_code?: number; result?: Record<string, unknown> };
  if (json.error_code !== 0) throw new TapoError(host, `refused the login (error ${json.error_code})`);
  return json.result ?? {};
}

/** Discover, register, share: three requests, after which the session is good until the bulb forgets it. */
export async function login(host: string, creds: Credentials, post: Post): Promise<Session> {
  const base = `http://${host}`;
  const discovered = await postJson(post, host, `${base}/`, { method: "login", params: { sub_method: "discover" } });
  const tpap = (discovered.tpap ?? {}) as { pake?: number[]; port?: number; tls?: number; user_hash_type?: number };
  if (tpap.tls && tpap.tls !== 0) throw new TapoError(host, "wants TLS for its local API, which is not supported yet");
  if (!(tpap.pake ?? []).some((kind) => kind === 2 || kind === 5)) {
    throw new TapoError(host, `offers no password login (pake ${JSON.stringify(tpap.pake)})`);
  }
  const app = tpap.port && tpap.port !== 80 ? `http://${host}:${tpap.port}` : base;
  const mac = String(discovered.mac ?? "").replace(/[:-]/g, "");

  const userRandom = randomBytes(32);
  const registered = await postJson(post, host, `${app}/`, {
    method: "login",
    params: {
      sub_method: "pake_register",
      username: tpap.user_hash_type === 1 ? hex("sha256", "admin").toUpperCase() : hex("md5", "admin"),
      user_random: userRandom.toString("base64"),
      cipher_suites: [1],
      encryption: ["aes_128_ccm"],
      passcode_type: "userpw",
      stok: null,
    },
  });
  if (Number(registered.cipher_suites) !== 1 || String(registered.encryption).toLowerCase() !== "aes_128_ccm") {
    throw new TapoError(host, `chose cipher suite ${registered.cipher_suites}/${registered.encryption}, which is not supported`);
  }

  let passcode: string;
  try {
    passcode = passcodeFor(registered.extra_crypt as ExtraCrypt | undefined, creds, mac);
  } catch (cause) {
    throw new TapoError(host, (cause as Error).message);
  }
  const { w0, w1 } = deriveScalars(
    passcode,
    Buffer.from(String(registered.dev_salt), "base64"),
    Number(registered.iterations),
  );

  const x = toBigInt(randomBytes(40)) % (N - 1n) + 1n;
  const share = add(multiply(G, x), multiply(M, w0));
  const devShare = decode(Buffer.from(String(registered.dev_share), "base64"));
  const unmasked = add(devShare, negate(multiply(N_POINT, w0)));
  const transcript = transcriptHash({
    userRandom,
    devRandom: Buffer.from(String(registered.dev_random), "base64"),
    share,
    devShare,
    z: multiply(unmasked, x),
    v: multiply(unmasked, w1),
    w0,
  });
  const confirm = confirmations(transcript, encode(share), encode(devShare));

  const shared = await postJson(post, host, `${app}/`, {
    method: "login",
    params: {
      sub_method: "pake_share",
      user_share: encode(share).toString("base64"),
      user_confirm: confirm.user.toString("base64"),
    },
  }).catch((cause: unknown) => {
    // -1501 and friends: the password hashed to the wrong verifier.
    throw cause instanceof TapoError
      ? new TapoError(host, `${cause.message.replace(`${host}: `, "")}; check TAPO_PASSWORD in .env`)
      : cause;
  });

  const devConfirm = Buffer.from(String(shared.dev_confirm ?? ""), "base64");
  if (!devConfirm.equals(confirm.device)) throw new TapoError(host, "could not prove it knows the password");
  const sessionId = String(shared.sessionId ?? shared.stok ?? "");
  if (!sessionId || shared.start_seq === undefined) throw new TapoError(host, "gave no session to use");

  const keys = sessionKeys(confirm.shared);
  return { url: `${app}/stok=${sessionId}/ds`, key: keys.key, nonce: keys.nonce, sequence: Number(shared.start_seq) };
}

const terminal = Buffer.from(randomUUID()).toString("base64");

/** One command over an established session. The session's sequence moves on whether or not it succeeds. */
export async function request(
  host: string,
  session: Session,
  method: string,
  params: object | null,
  post: Post,
): Promise<Record<string, unknown>> {
  const sequence = session.sequence++;
  const payload = JSON.stringify({ method, params, request_time_milis: Date.now(), terminal_uuid: terminal });
  const header = Buffer.alloc(4);
  header.writeUInt32BE(sequence);
  const reply = await post(session.url, Buffer.concat([header, seal(session.key, session.nonce, sequence, Buffer.from(payload))]));
  if (reply.status !== 200) throw new TapoError(host, `answered ${reply.status}`);

  // Session errors come back as plain JSON rather than sealed.
  if (reply.body[0] === 0x7b) {
    const json = JSON.parse(reply.body.toString()) as { error_code?: number };
    throw new TapoError(host, `rejected the session (error ${json.error_code})`);
  }
  if (reply.body.length < 4 + TAG_LENGTH) throw new TapoError(host, "sent a reply too short to be real");

  let json: { error_code?: number; result?: Record<string, unknown> };
  try {
    const plain = open(session.key, session.nonce, reply.body.readUInt32BE(0), reply.body.subarray(4));
    json = JSON.parse(plain.toString()) as typeof json;
  } catch {
    throw new TapoError(host, "sent a reply that could not be decrypted");
  }
  if (json.error_code !== 0) throw new TapoError(host, `rejected ${method} (error ${json.error_code})`);
  return json.result ?? {};
}
