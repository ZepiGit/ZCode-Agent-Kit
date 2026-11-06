// TCP sockets per pid on Windows (ticket 02): `netstat -ano` stands in for
// /proc/net/tcp + /proc/<pid>/fd. Used for the listener counts (S3, S4) and
// the "no real upstream" isolation proof (lib/proxy-session.mjs).
import { spawnSync } from "node:child_process";

/** `netstat -ano` text → [{ local, remote, state, pid }] for TCP lines (v4 and v6). */
export function parseNetstat(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== "TCP" || cols.length < 5) continue;
    out.push({ local: cols[1], remote: cols[2], state: cols[3], pid: Number(cols[4]) });
  }
  return out;
}

const portOf = (addr) => Number(addr.slice(addr.lastIndexOf(":") + 1));
const LOCAL = /^(?:127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|\[::\]|\*):/;

/** Ports a pid listens on, ascending and distinct. */
export function listenersOf(entries, pid) {
  return [...new Set(entries.filter((e) => e.pid === pid && e.state === "LISTENING").map((e) => portOf(e.local)))].sort((a, b) => a - b);
}

/** Non-loopback remote endpoints a pid holds (any state but LISTENING). */
export function externalOf(entries, pid) {
  return [...new Set(entries.filter((e) => e.pid === pid && e.state !== "LISTENING" && !LOCAL.test(e.remote)).map((e) => e.remote))];
}

/** All { local, remote, state } of a pid. */
export function connectionsOf(entries, pid) {
  return entries.filter((e) => e.pid === pid).map(({ local, remote, state }) => ({ local, remote, state }));
}

/** One `netstat -ano -p TCP` + `-p TCPv6` read (Windows only). */
export function netstat() {
  let text = "";
  for (const proto of ["TCP", "TCPv6"]) {
    const r = spawnSync("netstat", ["-ano", "-p", proto], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    text += r.stdout ?? "";
  }
  return parseNetstat(text);
}
