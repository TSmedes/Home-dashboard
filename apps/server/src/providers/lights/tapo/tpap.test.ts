import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { LightConfig } from "@home-dash/shared";
import { add, decode, encode, G, multiply, N, negate } from "./p256.js";
import {
  confirmations,
  deriveScalars,
  encodeW,
  login,
  open,
  passcodeFor,
  type Post,
  request,
  seal,
  sessionKeys,
  transcriptHash,
} from "./tpap.js";
import { forgetSessions, TapoLocalAdapter } from "./local.js";

const M = decode(Buffer.from("02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f", "hex"));
const NP = decode(Buffer.from("03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49", "hex"));

/**
 * The bulb's side of the protocol, playing the SPAKE2+ verifier: it holds w0
 * and L = w1*G, never the password. If the client and this agree on the
 * confirmations and session key, the client's half is the protocol's half.
 */
function fakeBulb(password: string, state: Record<string, unknown>) {
  const salt = randomBytes(80);
  const passcode = createHash("sha1").update(password).digest("hex");
  const { w0, w1 } = deriveScalars(passcode, salt, 3000);
  const L = multiply(G, w1);
  const devRandom = randomBytes(32);
  let userRandom = Buffer.alloc(0);
  let y = 0n;
  let devShare = G;
  let session: { key: Buffer; nonce: Buffer } | null = null;
  const log: string[] = [];

  const reply = (body: object) => ({ status: 200, body: Buffer.from(JSON.stringify(body)) });

  const post: Post = async (url, body) => {
    if (Buffer.isBuffer(body)) {
      if (!session) return reply({ error_code: -1 });
      const seq = body.readUInt32BE(0);
      const command = JSON.parse(open(session.key, session.nonce, seq, body.subarray(4)).toString());
      log.push(command.method);
      if (command.method === "set_device_info") Object.assign(state, command.params);
      const answer = Buffer.from(JSON.stringify({ error_code: 0, result: command.method === "get_device_info" ? state : {} }));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(seq);
      return { status: 200, body: Buffer.concat([header, seal(session.key, session.nonce, seq, answer)]) };
    }
    const params = (body as { params: Record<string, string> }).params;
    log.push(params.sub_method!);
    if (params.sub_method === "discover") {
      return reply({ error_code: 0, result: { mac: "A86E8474F1B3", tpap: { tls: 0, dac: 0, pake: [2], port: 80 } } });
    }
    if (params.sub_method === "pake_register") {
      userRandom = Buffer.from(params.user_random!, "base64");
      y = BigInt(`0x${randomBytes(32).toString("hex")}`) % N;
      devShare = add(multiply(G, y), multiply(NP, w0));
      return reply({
        error_code: 0,
        result: {
          extra_crypt: { type: "password_shadow", params: { passwd_id: 2 } },
          encryption: "aes_128_ccm",
          cipher_suites: 1,
          iterations: 3000,
          dev_random: devRandom.toString("base64"),
          dev_salt: salt.toString("base64"),
          dev_share: encode(devShare).toString("base64"),
        },
      });
    }
    // pake_share
    const share = decode(Buffer.from(params.user_share!, "base64"));
    const unmasked = add(share, negate(multiply(M, w0)));
    const transcript = transcriptHash({
      userRandom,
      devRandom,
      share,
      devShare,
      z: multiply(unmasked, y),
      v: multiply(L, y),
      w0,
    });
    const confirm = confirmations(transcript, encode(share), encode(devShare));
    if (!confirm.user.equals(Buffer.from(params.user_confirm!, "base64"))) return reply({ error_code: -1501 });
    session = sessionKeys(confirm.shared);
    return reply({
      error_code: 0,
      result: { dev_confirm: confirm.device.toString("base64"), sessionId: "abc", start_seq: 7 },
    });
  };

  return { post, log };
}

const creds = { username: "someone@example.com", password: "hunter2" };

describe("TPAP login", () => {
  it("agrees a session with a bulb that knows the same password", async () => {
    const bulb = fakeBulb("hunter2", { device_on: true, brightness: 40 });
    const session = await login("10.0.0.211", creds, bulb.post);
    expect(session.url).toBe("http://10.0.0.211/stok=abc/ds");
    expect(session.sequence).toBe(7);

    const info = await request("10.0.0.211", session, "get_device_info", null, bulb.post);
    expect(info).toMatchObject({ device_on: true, brightness: 40 });
    expect(session.sequence).toBe(8);
  });

  it("names the password as the problem when the bulb rejects it", async () => {
    const bulb = fakeBulb("something else", {});
    await expect(login("10.0.0.211", creds, bulb.post)).rejects.toThrow(/-1501.*TAPO_PASSWORD/);
  });
});

describe("passcodeFor", () => {
  it("hashes with SHA-1 when the bulb asks for password_shadow 2", () => {
    expect(passcodeFor({ type: "password_shadow", params: { passwd_id: 2 } }, creds, "")).toBe(
      createHash("sha1").update("hunter2").digest("hex"),
    );
  });

  it("says so rather than guessing at a hash it does not know", () => {
    expect(() => passcodeFor({ type: "password_shadow", params: { passwd_id: 9 } }, creds, "")).toThrow(/type 9/);
  });
});

describe("encodeW", () => {
  it("pads only odd-length values whose top bit is set", () => {
    expect(encodeW(0x80n).toString("hex")).toBe("0080");
    expect(encodeW(0x7fn).toString("hex")).toBe("7f");
    expect(encodeW(0x8000n).toString("hex")).toBe("8000");
  });
});

describe("TapoLocalAdapter", () => {
  const light: LightConfig = { id: "porch", name: "Porch", host: "10.0.0.211", type: "tapo", hidden: false };
  beforeEach(forgetSessions);

  it("reads the bulb and keeps its session for the next request", async () => {
    const bulb = fakeBulb("hunter2", { device_on: false, brightness: 70, color_temp: 2700, hue: 0, saturation: 0 });
    const adapter = new TapoLocalAdapter([light], creds, bulb.post);

    expect((await adapter.read()).lights[0]).toEqual({
      id: "porch",
      name: "Porch",
      reachable: true,
      on: false,
      brightness: 70,
      colourTemp: 2700,
      hue: 0,
      saturation: 0,
      minKelvin: 2500,
      maxKelvin: 6500,
    });
    await adapter.setColourTemp("porch", 9000);
    expect(bulb.log.filter((step) => step === "pake_share")).toHaveLength(1);
    expect((await adapter.read()).lights[0]).toMatchObject({ on: true, colourTemp: 6500 });
  });

  it("shows the bulb as unreachable without a password rather than failing the read", async () => {
    const adapter = new TapoLocalAdapter([light], null, fakeBulb("hunter2", {}).post);
    expect((await adapter.read()).lights[0]).toMatchObject({ reachable: false });
    await expect(adapter.setPower("porch", true)).rejects.toThrow(/TAPO_PASSWORD/);
  });
});
