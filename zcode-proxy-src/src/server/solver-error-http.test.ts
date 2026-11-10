import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// Child isolation prevents the external solver-provider fixture from replacing
// modules in other tests. The listener binds port 0; only loopback is allowed.
test("real HTTP errors and warnings exclude raw/mutable solver text and returned certifyIds on all three endpoints (15 cases)", async () => {
  const fixture = fileURLToPath(new URL("./__fixtures__/solver-error-http.ts", import.meta.url));
  const proc = Bun.spawn([process.execPath, fixture], { stdout: "pipe", stderr: "pipe" });
  // Track this owned PID only, in the inherited test process group.
  const timer = setTimeout(() => proc.kill("SIGKILL"), 15_000);
  try {
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain('"executed":15,"passed":15,"failed":0');
    expect(stdout).toContain('"localRequests":15,"upstreamFixtureCalls":12,"blockedExternalFetches":0');
    expect(stdout.match(/"scenario":"returned-certifyid-marker"/g)).toHaveLength(3);
    expect(stdout.match(/"exactReply":true,"exactWarnings":true/g)).toHaveLength(3);
    expect(stdout).toContain('"listenerClosed":true');
  } finally { clearTimeout(timer); await proc.exited; }
});
