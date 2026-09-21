#!/usr/bin/env node
/**
 * Find Kasa devices on the local network and report which protocol they speak.
 *
 * TP-Link's original protocol is a trivially reversible XOR autokey cipher over
 * UDP 9999. Newer Kasa firmware replaced it with an encrypted KLAP handshake,
 * which does not answer this probe at all - so a bulb you can see in the Kasa
 * app but not here has moved to KLAP and needs the cloud fallback.
 *
 * Run this on the host, not inside the container: Docker's bridge network does
 * not carry the broadcast this relies on.
 *
 *   node scripts/find-kasa.mjs
 */
import { createSocket } from "node:dgram";

const PORT = 9999;
const PROBE = '{"system":{"get_sysinfo":{}}}';
const LISTEN_MS = Number(process.env.KASA_TIMEOUT_MS ?? 4000);

/** XOR autokey, seeded with 171. Each output byte becomes the next key. */
function encrypt(text) {
  let key = 171;
  return Buffer.from([...Buffer.from(text, "utf8")].map((b) => (key = b ^ key)));
}

function decrypt(buffer) {
  let key = 171;
  return Buffer.from(
    [...buffer].map((c) => {
      const plain = c ^ key;
      key = c;
      return plain;
    }),
  ).toString("utf8");
}

const found = new Map();
const socket = createSocket({ type: "udp4", reuseAddr: true });

socket.on("message", (message, remote) => {
  let info;
  try {
    info = JSON.parse(decrypt(message))?.system?.get_sysinfo;
  } catch {
    return;
  }
  if (!info || found.has(remote.address)) return;
  found.set(remote.address, {
    host: remote.address,
    name: info.alias ?? "(unnamed)",
    model: info.model ?? "unknown",
    type: info.mic_type ?? info.type ?? "unknown",
    mac: info.mic_mac ?? info.mac ?? "",
    firmware: info.sw_ver ?? "",
  });
});

socket.on("error", (error) => {
  console.error(`Socket error: ${error.message}`);
  process.exit(1);
});

socket.bind(() => {
  socket.setBroadcast(true);
  const payload = encrypt(PROBE);
  for (const target of ["255.255.255.255", "192.168.255.255", "10.255.255.255"]) {
    socket.send(payload, PORT, target, () => {});
  }
  console.log(`Listening ${LISTEN_MS / 1000}s for Kasa devices...\n`);
});

setTimeout(() => {
  socket.close();

  if (found.size === 0) {
    console.log("No Kasa devices answered.\n");
    console.log("That means one of:");
    console.log("  - this machine is on a different subnet or VLAN than the bulbs");
    console.log("  - the bulbs are powered off at the wall");
    console.log("  - the firmware has moved to KLAP, which ignores this probe");
    console.log("\nIf the bulbs work in the Kasa app but not here, assume KLAP and");
    console.log("set KASA_USERNAME and KASA_PASSWORD in .env to use the cloud path.");
    process.exit(2);
  }

  console.log(`Found ${found.size} device(s) speaking the local protocol:\n`);
  for (const device of found.values()) {
    console.log(`  ${device.host.padEnd(16)} ${device.name}`);
    console.log(`  ${"".padEnd(16)} ${device.model}  firmware ${device.firmware}\n`);
  }

  console.log("Add these to config.yaml, using a router DHCP reservation so the");
  console.log("addresses do not move:\n");
  console.log("lights:");
  for (const device of found.values()) {
    const id = device.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bulb";
    console.log(`  - { id: ${id}, name: "${device.name}", host: ${device.host} }`);
  }
  console.log();
}, LISTEN_MS);
