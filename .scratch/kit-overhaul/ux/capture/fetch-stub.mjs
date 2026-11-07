// UX capture fixture, loaded with `node --import` for the `update` (release
// mode) captures only: GitHub release URLs are answered from UX_RELEASE_DIR
// (a locally built fixture tarball + checksums.txt). Loopback requests pass
// through unchanged; every other host is refused so no capture can reach the
// network.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.UX_RELEASE_DIR;
const latest = process.env.UX_RELEASE_LATEST ?? "v9.9.9";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") return realFetch(input, init);
  if (url.hostname === "api.github.com" && url.pathname.endsWith("/releases/latest")) {
    return new Response(JSON.stringify({ tag_name: latest }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.hostname === "github.com" && url.pathname.includes("/releases/download/")) {
    const file = join(dir ?? "/nonexistent", url.pathname.split("/").pop());
    if (existsSync(file)) return new Response(readFileSync(file), { status: 200 });
    return new Response("not found", { status: 404 });
  }
  throw new Error(`fetch-stub: network access refused in UX capture (${url.hostname})`);
};
