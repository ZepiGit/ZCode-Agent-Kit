import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { isAllowedRequestUrl } from "./captcha-happy.js";

// Guest code from the captcha CDN chooses the request URLs that reach the
// interceptors, so the allowlist is a trust boundary rather than a hint.
describe("captcha egress allowlist", () => {
  it("allows the captcha CDN and provider hosts over https", () => {
    for (const url of [
      "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
      "https://zcode.z.ai/api/v1/client/configs",
      "https://captcha.aliyuncs.com/verify",
    ]) {
      expect(isAllowedRequestUrl(url)).toBe(true);
    }
  });

  it("refuses loopback, metadata and private targets", () => {
    for (const url of [
      "https://127.0.0.1:8457/v1/models",
      "https://localhost/v1/models",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/internal",
      "https://192.168.1.10/admin",
    ]) {
      expect(isAllowedRequestUrl(url)).toBe(false);
    }
  });

  it("refuses non-https schemes, including local file reads", () => {
    for (const url of [
      "file:///etc/passwd",
      "http://o.alicdn.com/x.js",
      "data:text/html,<script>1</script>",
    ]) {
      expect(isAllowedRequestUrl(url)).toBe(false);
    }
  });

  it("matches the hostname, not a substring anywhere in the URL", () => {
    for (const url of [
      "https://attacker.test/x?ref=alicdn.com",
      "https://alicdn.com.attacker.test/x.js",
      "https://notalicdn.com/x.js",
    ]) {
      expect(isAllowedRequestUrl(url)).toBe(false);
    }
  });

  it("rejects malformed input instead of throwing", () => {
    for (const url of ["", "not a url", "https://"]) {
      expect(isAllowedRequestUrl(url)).toBe(false);
    }
  });
});

// Egress routing (spec §13, story 130). Bun ignores undici's `dispatcher`, so
// the configured ZCODE_PROXY_UPSTREAM_PROXY must reach Bun's own `proxy`
// option, and an unset setting must not fall back to ambient HTTP(S)_PROXY.
// Everything here is loopback: the recording proxies answer absolute-form
// requests themselves and refuse every CONNECT, so nothing is ever forwarded
// or tunnelled to another host, whichever route the code under test takes.
// The module reads the setting once at load, so each scenario is a child Bun
// process with its own environment, as the solver worker has.
describe("captcha egress routing (captchaFetch and the sync-XHR worker)", () => {
  const modulePath = fileURLToPath(new URL("./captcha-happy.ts", import.meta.url));
  const arrivals: string[] = [];
  const servers: (http.Server | net.Server)[] = [];
  let configuredProxy = "";
  let ambientProxy = "";
  let target = "";
  let tlsPort = 0;

  const listen = async (server: http.Server | net.Server): Promise<number> => {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  };
  const recordingProxy = async (name: string): Promise<string> => {
    const server = http.createServer((req, res) => {
      arrivals.push(`${name} ${req.method} ${req.url}`);
      res.end(`via ${name}`);
    });
    server.on("connect", (req, socket) => {
      arrivals.push(`${name} CONNECT ${req.url}`);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    return `http://127.0.0.1:${await listen(server)}`;
  };

  beforeAll(async () => {
    configuredProxy = await recordingProxy("configured");
    ambientProxy = await recordingProxy("ambient");
    const direct = http.createServer((req, res) => {
      arrivals.push(`target ${req.method} ${req.url}`);
      res.end("direct");
    });
    target = `http://127.0.0.1:${await listen(direct)}`;
    // Stands in for an https origin: it records the connection and closes it.
    tlsPort = await listen(net.createServer((socket) => {
      arrivals.push("tls-target connection");
      socket.destroy();
    }));
  });
  afterAll(() => {
    for (const server of servers) server.close();
  });

  async function egress(env: Record<string, string>) {
    arrivals.length = 0;
    const inherited = Object.fromEntries(Object.entries(process.env)
      .filter(([name, value]) => value !== undefined && !/_proxy$/i.test(name) && name !== "ZCODE_PROXY_UPSTREAM_PROXY")) as Record<string, string>;
    const child = Bun.spawn([process.execPath, "--eval", `
      import { captchaFetch, syncFetchBlocking } from ${JSON.stringify(modulePath)};
      const target = ${JSON.stringify(target)};
      const out = {};
      try { const r = await captchaFetch(target + "/fetch"); out.fetch = r.status + " " + await r.text(); }
      catch { out.fetch = "error"; }
      const s = syncFetchBlocking(target + "/sync-xhr", { method: "GET", headers: {} }, 5000);
      out.syncXhr = "error" in s ? "error" : s.status + " " + s.body.toString();
      try { const r = await captchaFetch("https://127.0.0.1:${tlsPort}/tls"); out.tls = String(r.status); await r.body?.cancel(); }
      catch { out.tls = "error"; }
      console.log(JSON.stringify(out));
      process.exit(0);
    `], { env: { ...inherited, ...env }, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
    return { results: JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}"), arrivals: [...arrivals].sort() };
  }
  const ambient = () => ({ HTTP_PROXY: ambientProxy, HTTPS_PROXY: ambientProxy, ALL_PROXY: ambientProxy });

  it("sends every captcha request through the configured proxy, not the ambient one", async () => {
    const run = await egress({ ...ambient(), ZCODE_PROXY_UPSTREAM_PROXY: configuredProxy });
    expect(run.arrivals).toEqual([
      `configured CONNECT 127.0.0.1:${tlsPort}`,
      `configured GET ${target}/fetch`,
      `configured GET ${target}/sync-xhr`,
    ]);
    expect(run.results.fetch).toBe("200 via configured");
    expect(run.results.syncXhr).toBe("200 via configured");
  }, 30_000);

  // Bun 1.4.2 (the pinned runtime) ignores `proxy: false` and still reads the
  // ambient variables; 1.4.3 honours it. Until ticket 62 moves the pin, this
  // case is declared failing there, so it turns into a plain test on the move.
  const unsetCase = Bun.semver.satisfies(Bun.version, ">=1.4.3") ? it : it.failing;
  unsetCase("goes direct when the setting is unset, even with ambient HTTP(S)_PROXY", async () => {
    const run = await egress(ambient());
    expect(run.arrivals).toEqual([
      "target GET /fetch",
      "target GET /sync-xhr",
      "tls-target connection",
    ]);
    expect(run.results.fetch).toBe("200 direct");
    expect(run.results.syncXhr).toBe("200 direct");
  }, 30_000);

  it("fails closed on an invalid configured proxy instead of taking another route", async () => {
    const run = await egress({ ...ambient(), ZCODE_PROXY_UPSTREAM_PROXY: "not a proxy url" });
    expect(run.arrivals).toEqual([]);
    expect(run.results).toEqual({ fetch: "error", syncXhr: "error", tls: "error" });
  }, 30_000);
});
