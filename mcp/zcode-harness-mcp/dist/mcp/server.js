/**
 * MCP server assembly: low-level SDK Server with tools + resources over
 * stdio (default) or streamable HTTP (explicitly enabled).
 *
 * stdio: nothing except MCP frames is written to stdout; logs go to stderr.
 * http: binds only the configured host (default 127.0.0.1) — never a public
 * interface; streamable HTTP with per-session transports.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { createServer as createHttpServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { buildTools, toolTextPayload } from "./tools.js";
import { listResources, readResource } from "./resources.js";
import { createLogger } from "../util/log.js";
import { redactDeep } from "../security/redact.js";
const log = createLogger("mcp");
function buildServer(opts) {
    const tools = buildTools(opts.toolCtx);
    const server = new Server(opts.serverInfo, {
        capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false },
            logging: {},
        },
    });
    server.setRequestHandler(ListToolsRequestSchema, async (_req) => ({
        tools: tools.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.mutating ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false } : { readOnlyHint: true, idempotentHint: true },
        })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const name = String(req.params?.name ?? "");
        const args = (req.params?.arguments ?? {});
        const tool = tools.find((t) => t.name === name);
        if (!tool) {
            return {
                isError: true,
                content: [{ type: "text", text: `unknown tool: ${name}` }],
            };
        }
        try {
            const result = await tool.handler(args);
            const text = toolTextPayload(result);
            return {
                content: [{ type: "text", text }],
                structuredContent: redactDeep(result),
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.warn("tool failed", { tool: name, error: message });
            return {
                isError: true,
                content: [{ type: "text", text: message }],
            };
        }
    });
    server.setRequestHandler(ListResourcesRequestSchema, async (_req) => ({
        resources: listResources(opts.resourceCtx),
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
        const uri = String(req.params?.uri ?? "");
        try {
            return await readResource(opts.resourceCtx, uri);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw Object.assign(new Error(message), { code: -32002 });
        }
    });
    return server;
}
export async function serveStdio(opts) {
    const server = buildServer(opts);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.info("bridge ready on stdio");
    // Keep the process alive until stdin closes (transport handles it).
}
export async function serveHttp(opts, host, port, httpKey) {
    // Defense in depth: the config already rejects non-loopback hosts; assert
    // again here so no future call site can quietly widen the bind.
    const h = host.replace(/^\[|\]$/g, "").toLowerCase();
    const loopback = h === "127.0.0.1" || h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
    if (!loopback)
        throw new Error(`refusing to bind HTTP transport to non-loopback host "${host}"`);
    if (!httpKey)
        throw new Error("HTTP transport requires an auth key — refusing to serve unauthenticated requests");
    const keyBuf = Buffer.from(httpKey, "utf8");
    const PORT = port;
    const allowedHosts = new Set([`${h === "::1" ? "[::1]" : h}:${PORT}`]);
    if (h !== "::1") {
        allowedHosts.add(`127.0.0.1:${PORT}`);
        allowedHosts.add(`localhost:${PORT}`);
    }
    else {
        allowedHosts.add(`[::1]:${PORT}`);
    }
    // Simple request-pressure limits: the bridge controls a desktop app, not a
    // public API. Parallel requests above the cap are shed with 503.
    let inFlight = 0;
    const MAX_IN_FLIGHT = 16;
    const MAX_BODY_BYTES = 4 * 1024 * 1024;
    const httpServer = createHttpServer((req, res) => {
        // Exact Host check (anti DNS-rebinding): a browser-side attacker can force
        // a Host header, so only the literal loopback host:port pairs are accepted.
        const hostHeader = String(req.headers.host ?? "");
        if (!allowedHosts.has(hostHeader)) {
            res.writeHead(403).end("host not allowed");
            return;
        }
        // Bearer auth on EVERY request, before any routing: unauthenticated
        // requests must reach no tools, tasks, or resources. Timing-safe compare.
        const auth = String(req.headers.authorization ?? "");
        const expected = Buffer.from(`Bearer ${httpKey}`, "utf8");
        const given = Buffer.from(auth, "utf8");
        const authOk = given.length === expected.length && timingSafeEqual(given, expected);
        if (!authOk) {
            res.writeHead(401, { "WWW-Authenticate": "Bearer", "Content-Type": "text/plain" });
            res.end("unauthorized: set Authorization: Bearer <key> (the bridge never serves unauthenticated requests)");
            return;
        }
        // Exact Origin check: parse, compare hostname+port literally. The previous
        // startsWith("http://127.0.0.1") check accepted hosts like 127.0.0.1.evil.
        const origin = req.headers.origin;
        if (origin) {
            try {
                const o = new URL(String(origin));
                const originHost = o.hostname;
                const originPort = o.port === "" ? (o.protocol === "https:" ? 443 : 80) : Number(o.port);
                const originOk = (originHost === "127.0.0.1" || originHost === "localhost" || originHost === "[::1]" || originHost === "::1") &&
                    originPort === PORT &&
                    o.protocol === "http:";
                if (!originOk) {
                    res.writeHead(403).end("origin not allowed");
                    return;
                }
            }
            catch {
                res.writeHead(403).end("origin not allowed");
                return;
            }
        }
        if (inFlight >= MAX_IN_FLIGHT) {
            res.writeHead(503).end("busy");
            return;
        }
        inFlight += 1;
        res.on("close", () => { inFlight -= 1; });
        const url = new URL(req.url ?? "/", `http://${hostHeader}`);
        if (url.pathname !== "/mcp") {
            res.writeHead(404).end("not found");
            return;
        }
        // Streamable HTTP semantics are POST-only in the stateless setup; other
        // methods (GET SSE / DELETE) are not offered.
        if (req.method !== "POST") {
            res.writeHead(405).end("method not allowed");
            return;
        }
        // ZAK-010: the 4 MiB bound is enforced on the ACTUAL stream, not just the
        // declared Content-Length (chunked/absent-length requests bypassed the
        // metadata check). The body is pre-read into a bounded buffer and the
        // transport receives a fresh stream built from that buffer — so the size
        // guard is a real parser boundary AND the transport cannot be starved
        // (it never observes the original request stream).
        void handleMcpPostBounded(opts, req, res, MAX_BODY_BYTES);
    });
    // Header/timeout hardening (defaults are generous for a local bridge).
    httpServer.headersTimeout = 10_000;
    httpServer.requestTimeout = 120_000;
    httpServer.keepAliveTimeout = 30_000;
    await new Promise((resolve) => httpServer.listen(port, host, resolve));
    log.info("bridge ready on http", { host, port, path: "/mcp", auth: "bearer" });
    const sessionId = randomUUID().slice(0, 8);
    log.info("http bridge instance", { sessionId });
    // Returned for clean shutdown (tests, embedded use).
    return () => new Promise((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
    });
}
async function handleMcpPostBounded(opts, req, res, maxBodyBytes) {
    try {
        // ZAK-010: enforce the body bound on the ACTUAL stream, not just the
        // declared Content-Length (chunked/absent-length requests bypassed the
        // metadata check). Oversized uploads are drained and discarded (keeping
        // the connection healthy so the client reliably receives the 413) and
        // never parsed. Under the bound, the parsed body is handed to the
        // transport via its pre-parsed-body API so the original request stream
        // semantics stay intact for hono/node-server.
        const buffered = [];
        let total = 0;
        let tooLarge = false;
        for await (const chunk of req) {
            if (tooLarge)
                continue; // drain and discard the remainder
            const buf = chunk;
            total += buf.length;
            if (total > maxBodyBytes) {
                tooLarge = true;
                buffered.length = 0;
                continue;
            }
            buffered.push(buf);
        }
        if (tooLarge) {
            res.writeHead(413).end("request body too large");
            return;
        }
        const raw = Buffer.concat(buffered).toString("utf8");
        let parsedBody;
        try {
            parsedBody = JSON.parse(raw);
        }
        catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
            return;
        }
        await handleMcpPost(opts, req, res, parsedBody);
    }
    catch (err) {
        log.error("http request read error", { error: String(err) });
        if (!res.headersSent)
            res.writeHead(400).end("bad request");
        else
            try {
                res.end();
            }
            catch { /* already gone */ }
    }
}
async function handleMcpPost(opts, req, res, parsedBody) {
    try {
        // Stateless streamable HTTP: each POST creates a request-scoped transport.
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        const server = buildServer(opts);
        await server.connect(transport);
        // parsedBody comes from our bounded pre-read (ZAK-010); the transport's
        // pre-parsed-body path skips reading the (already consumed) request stream.
        await transport.handleRequest(req, res, parsedBody);
        res.on("close", () => {
            transport.close();
            server.close();
        });
    }
    catch (err) {
        log.error("http transport error", { error: String(err) });
        if (!res.headersSent)
            res.writeHead(500).end("internal error");
    }
}
