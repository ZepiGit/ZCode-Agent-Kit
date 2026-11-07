// `zcode-kit usage --json`: the running proxy's /quota answer as JSON.
// Exit 0 when the proxy answers 2xx, 1 otherwise (including no answer).
import { proxyFetch } from "./common.mjs";

export async function run(_args, ctx) {
  try {
    const res = await proxyFetch(ctx, "/quota");
    const body = await res.json();
    return { exitCode: res.ok ? 0 : 1, records: [{ kind: "json", value: body }] };
  } catch (err) {
    return { exitCode: 1, records: [{ kind: "json", value: { error: { type: "quota_unavailable", message: String(err.message) } } }] };
  }
}
