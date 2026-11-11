/** Synthetic metadata persistence at the existing AuthManager boundary.
 * Real listener, stop route, shutdown and bounded flush; no upstream requests,
 * credential store or scheduler policy changes. The first write fails so only
 * shutdown (not the 60 s background retry) can persist before the child exits.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { AuthManager } from "../../auth/manager.js";
import { createAccountRotator } from "../../auth/account-rotator.js";
import { loadConfig } from "../../config/loader.js";
import { startServer } from "../../server/server.js";
import { buildServerOptions } from "../../server/server-options.js";
import { createGracefulShutdown } from "../supervisor.js";
import { flushAccountMetadata } from "../../index.js";

const config = loadConfig(process.argv[2]);
const metadataPath = process.env.SYNTHETIC_METADATA_PATH!;
if (!metadataPath || !metadataPath.endsWith("synthetic-metadata.json")) throw new Error("isolated fixture only");
const credential = { apiKey: "synthetic-dirty-stop-key", provider: "zai" as const };
const rotator = createAccountRotator([
  { id: "synthetic", credential, lastFailureAt: 1, exhaustedUntil: 2, lastFailureReason: "quota_exhausted" },
], { now: () => 1000 });
let writes = 0;
const auth = new AuthManager({
  accountRotator: rotator,
  persistenceRetryDelaysMs: [60_000],
  persistAccounts: async profiles => {
    if (++writes === 1) throw new Error("synthetic metadata writer temporarily busy");
    // Metadata only. Never serialize credentials, even synthetic ones.
    writeFileSync(metadataPath, JSON.stringify(profiles.map(({ id, failureGeneration, lastFailureAt, exhaustedUntil }) => ({ id, failureGeneration, lastFailureAt, exhaustedUntil }))));
  },
});
auth.markCredentialHealthy(credential); // existing metadata mutation, no selection/retry
await Bun.sleep(0);
if (!auth.getPersistenceStatus().unsaved || writes !== 1) throw new Error("fixture must begin dirty");
if (JSON.parse(readFileSync(metadataPath, "utf8"))[0].failureGeneration !== 0) throw new Error("metadata unexpectedly persisted before stop");
let stop!: () => void;
const server = await startServer({
  ...buildServerOptions(config, auth, false, { stopToken: process.env.ZCODE_KIT_STOP_TOKEN, onStopRequest: () => stop() }),
  fetchImpl: (async () => { throw new Error("fixture forbids upstream"); }) as unknown as typeof fetch,
});
const shutdown = createGracefulShutdown({ server, flush: () => flushAccountMetadata(auth) });
stop = () => { void shutdown.run("stop"); };
console.log(`dirty fixture listening on http://127.0.0.1:${server.port}`);
