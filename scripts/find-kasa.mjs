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
 * Broadcast alone is unreliable on Linux servers: a bulb answers from its own
 * address, which a stateful firewall (ufw, firewalld) does not match to a
 * probe sent to a broadcast address, so the reply is dropped. After the
 * broadcast, the probe is therefore sent unicast to every address on each
 * local subnet, whose replies the firewall does recognise.
 *
 *   node scripts/find-kasa.mjs              # scan every local subnet
 *   node scripts/find-kasa.mjs 10.0.0.147   # probe specific addresses only
 */
import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";

const PORT = 9999;
const PROBE = '{"system":{"get_sysinfo":{}}}';
const LISTEN_MS = Number(process.env.KASA_TIMEOUT_MS ?? 4000);
/** Subnets larger than this are too big to sweep address by address. */
const MAX_SWEEP_HOSTS = 1024;
/** Container and VM bridges never have bulbs on them. */
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|cni|flannel|tailscale|zt|wg|lo)/i;

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

const toInt = (ip) => ip.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);
const toIp = (n) => [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");

/** Each physical IPv4 interface's subnet: its broadcast and host addresses. */
function localSubnets() {
  const subnets = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" && address.family !== 4) continue;
      if (address.internal) continue;
      const mask = toInt(address.netmask);
      const size = 2 ** 32 - mask;
      const network = toInt(address.address) - (toInt(address.address) % size);
      subnets.push({
        name,
        self: address.address,
        cidr: address.cidr ?? `${toIp(network)}/${32 - Math.log2(size)}`,
        broadcast: toIp(network + size - 1),
        hosts: size - 2 <= MAX_SWEEP_HOSTS
          ? Array.from({ length: size - 2 }, (_, i) => toIp(network + 1 + i))
          : [],
      });
    }
  }
  return subnets;
}

const explicitHosts = process.argv.slice(2);
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

socket.bind(async () => {
  socket.setBroadcast(true);
  const payload = encrypt(PROBE);
  const send = (target) =>
    new Promise((resolve) => socket.send(payload, PORT, target, () => resolve()));

  if (explicitHosts.length > 0) {
    console.log(`Probing ${explicitHosts.join(", ")}...`);
    for (const host of explicitHosts) await send(host);
  } else {
    const subnets = localSubnets();
    for (const subnet of subnets) {
      const sweep = subnet.hosts.length > 0
        ? `sweeping ${subnet.hosts.length} addresses`
        : "too large to sweep";
      console.log(`  ${subnet.name.padEnd(12)} ${subnet.cidr.padEnd(18)} ${sweep}`);
    }
    await send("255.255.255.255");
    for (const subnet of subnets) await send(subnet.broadcast);
    for (const subnet of subnets) {
      for (const host of subnet.hosts) if (host !== subnet.self) await send(host);
    }
  }
  console.log(`\nListening ${LISTEN_MS / 1000}s for Kasa devices...\n`);
});

setTimeout(() => {
  socket.close();

  if (found.size === 0) {
    console.log("No Kasa devices answered.\n");
    console.log("That means one of:");
    console.log("  - this machine is on a different subnet or VLAN than the bulbs");
    console.log("  - the bulbs are powered off at the wall");
    console.log("  - a firewall here drops inbound UDP from port 9999");
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
