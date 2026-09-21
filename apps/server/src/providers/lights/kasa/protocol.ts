import { connect } from "node:net";

export const KASA_PORT = 9999;

/**
 * TP-Link's "encryption" is an XOR autokey cipher seeded with 171: each
 * ciphertext byte becomes the key for the next. It is obfuscation, not
 * security, which is worth knowing - anything on the LAN can read and forge
 * these, so the bulbs are only as protected as the network they sit on.
 */
export function encrypt(text: string): Buffer {
  let key = 171;
  return Buffer.from([...Buffer.from(text, "utf8")].map((byte) => (key = byte ^ key)));
}

export function decrypt(buffer: Buffer): string {
  let key = 171;
  return Buffer.from(
    [...buffer].map((cipher) => {
      const plain = cipher ^ key;
      key = cipher;
      return plain;
    }),
  ).toString("utf8");
}

/** TCP frames carry a four-byte big-endian length prefix; UDP frames do not. */
export function frame(text: string): Buffer {
  const body = encrypt(text);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Whether a buffer holds a complete framed response yet. */
export function isComplete(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.length - 4 >= buffer.readUInt32BE(0);
}

export function unframe(buffer: Buffer): string {
  return decrypt(buffer.subarray(4, 4 + buffer.readUInt32BE(0)));
}

export class KasaError extends Error {
  constructor(
    readonly host: string,
    message: string,
  ) {
    super(`${host}: ${message}`);
    this.name = "KasaError";
  }
}

/** Send one command and read one reply. Kasa devices accept a single request per connection. */
export function send(host: string, command: unknown, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect({ host, port: KASA_PORT });
    socket.setTimeout(timeoutMs);

    const fail = (reason: string) => {
      socket.destroy();
      reject(new KasaError(host, reason));
    };

    socket.on("connect", () => socket.write(frame(JSON.stringify(command))));
    socket.on("timeout", () => fail("timed out; is the bulb powered on?"));
    socket.on("error", (error) => fail(error.message));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const all = Buffer.concat(chunks);
      if (!isComplete(all)) return;
      socket.end();
      try {
        resolve(JSON.parse(unframe(all)));
      } catch {
        fail("sent a reply that could not be parsed");
      }
    });
  });
}
