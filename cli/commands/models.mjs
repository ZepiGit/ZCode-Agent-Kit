// `zcode-kit models [--json] [--show-key]`: the running proxy's model list,
// or the registry snapshot when the proxy does not answer. Always exit 0.
// The list and the key are data records (ticket 46): they render through the
// output module with today's exact bytes.
import { keepRecords, proxyFetch, stderrLine } from "./common.mjs";

/** The models the kit's synced registry copy names (the proxy-down answer). */
const REGISTRY_SNAPSHOT = ["glm-5.3", "glm-5.3-flash"];

/** @param {{ flags: Record<string, unknown> }} args */
export async function run({ flags }, ctx) {
  const records = [];
  try {
    let list = null;
    let fromProxy = false;
    try {
      const res = await proxyFetch(ctx, "/v1/models");
      if (res.ok) {
        const body = await res.json();
        list = (body.data ?? []).map((m) => m.id);
        fromProxy = true;
      }
    } catch {}
    // Proxy down: report the registry snapshot from the kit's synced copy.
    if (!list) list = [...REGISTRY_SNAPSHOT];
    if (flags.json) {
      // source must reflect where the list actually came from — a registry
      // fallback is NOT a proxy answer and must not be labeled as one.
      records.push({ kind: "json", value: { models: list, source: fromProxy ? "proxy" : "registry" } });
    } else {
      records.push({ kind: "data", text: `${list.join("\n")}\n` });
    }
    if (flags["show-key"]) {
      records.push(stderrLine("\nlocal proxy key (never share; shown because --show-key was given):"));
      records.push({ kind: "data", text: `${ctx.kit.key()}\n` });
    }
    return { exitCode: 0, records };
  } catch (err) {
    throw keepRecords(err, records);
  }
}
