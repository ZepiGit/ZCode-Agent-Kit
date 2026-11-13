/**
 * MCP server assembly: low-level SDK Server with tools + resources over
 * stdio (default) or streamable HTTP (explicitly enabled).
 *
 * stdio: nothing except MCP frames is written to stdout; logs go to stderr.
 * http: binds only the configured host (default 127.0.0.1) — never a public
 * interface; streamable HTTP with per-session transports.
 *
 * The HTTP stack (node:http, the SDK's Node HTTP adapter and hono) is
 * imported lazily inside serveHttp: the stdio bridge, one per harness
 * session, never loads it.
 *
 * MCP SDK 2.x (`@modelcontextprotocol/server`, and `@modelcontextprotocol/node`
 * for HTTP). The bridge wires the low-level Server to a transport itself, so
 * it serves the 2025-era protocol revisions only: `initialize` negotiates at
 * most 2025-11-25.
 */
import { Server, } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { buildTools, toolTextPayload } from "./tools.js";
import { listResources, readResource } from "./resources.js";
import { validateArguments } from "./validate.js";
import { createLogger } from "../util/log.js";
import { redactExcept, redactText } from "../security/redact.js";
const log = createLogger("mcp");
// JSON-RPC error codes of a failed resources/read: what the 2025-era protocol
// revisions define for it, and what SDK 2.x puts on the wire instead.
const RESOURCE_NOT_FOUND = -32002;
const INVALID_PARAMS = -32602;
function buildServer(opts) {
    const tools = buildTools(opts.toolCtx);
    const failedReads = new Set();
    const server = new Server(opts.serverInfo, {
        capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false },
            logging: {},
        },
    });
    server.setRequestHandler("tools/list", async () => ({
        tools: tools.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            // The tools declare object schemas (tools.ts); their TypeScript type is only wider.
            inputSchema: t.inputSchema,
            annotations: t.mutating ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false } : { readOnlyHint: true, idempotentHint: true },
        })),
    }));
    server.setRequestHandler("tools/call", async (req) => {
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
            // Enforce the declared inputSchema before the handler sees args.
            validateArguments(tool.inputSchema, args);
            const result = await tool.handler(args);
            const text = toolTextPayload(result, tool.verbatim);
            if (tool.mutating)
                log.info("mutating tool call", { tool: name });
            return {
                content: [{ type: "text", text }],
                structuredContent: redactExcept(result, tool.verbatim ?? []),
            };
        }
        catch (err) {
            // Error texts can echo harness payloads — redact them too.
            const message = redactText(err instanceof Error ? err.message : String(err));
            log.warn("tool failed", { tool: name, error: message });
            return {
                isError: true,
                content: [{ type: "text", text: message }],
            };
        }
    });
    server.setRequestHandler("resources/list", async () => ({
        resources: listResources(opts.resourceCtx),
    }));
    server.setRequestHandler("resources/read", async (req, ctx) => {
        const uri = String(req.params?.uri ?? "");
        try {
            return await readResource(opts.resourceCtx, uri);
        }
        catch (err) {
            const message = redactText(err instanceof Error ? err.message : String(err));
            // Noted for connectServer's send; a cancelled request gets no answer, so its note goes.
            const { id, signal } = ctx.mcpReq;
            if (!signal.aborted) {
                failedReads.add(id);
                signal.addEventListener("abort", () => failedReads.delete(id), { once: true });
            }
            throw Object.assign(new Error(message), { code: RESOURCE_NOT_FOUND });
        }
    });
    return { server, failedReads };
}
/**
 * Connects the server to the transport. A failed resources/read keeps its
 * error code -32002 on the wire: SDK 2.x rewrites a handler's -32002 to
 * -32602 just before the transport on every protocol revision, while the
 * 2025-era revisions define -32002 for it and the bridge has always sent
 * that. The read handler notes the request id; the answer to that id gets
 * the code back here, and nothing else is touched.
 */
async function connectServer({ server, failedReads }, transport) {
    const send = transport.send.bind(transport);
    transport.send = (message, options) => {
        if ("error" in message && message.id !== undefined && failedReads.delete(message.id) && message.error.code === INVALID_PARAMS) {
            return send({ ...message, error: { ...message.error, code: RESOURCE_NOT_FOUND } }, options);
        }
        return send(message, options);
    };
    await server.connect(transport);
}
export async function serveStdio(opts) {
    const bridge = buildServer(opts);
    await connectServer(bridge, new StdioServerTransport());
    log.info("bridge ready on stdio");
    return () => bridge.server.close();
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
    // Lazy HTTP: loaded once here, before listen, so a missing module still
    // fails at start and no request pays for the import.
    const [{ createServer: createHttpServer }, { NodeStreamableHTTPServerTransport: HttpTransport }] = await Promise.all([
        import("node:http"),
        import("@modelcontextprotocol/node"),
    ]);
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
        // The 4 MiB bound is enforced on the ACTUAL stream, not
        // just the declared Content-Length. Oversized requests are refused the
        // moment the limit is crossed (413 + Connection: close, then socket
        // teardown) — draining until EOF would let a slow writer bind one of the
        // few request slots for the whole request timeout.
        void handleMcpPostBounded(opts, HttpTransport, req, res, MAX_BODY_BYTES);
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
async function handleMcpPostBounded(opts, HttpTransport, req, res, maxBodyBytes) {
    try {
        // Declared-size fast path: refuse before reading any bytes when
        // a truthful Content-Length already exceeds the bound. (Conflicting or
        // duplicate content-length headers are rejected by Node's HTTP parser.)
        const declared = Number(req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBodyBytes) {
            res.writeHead(413, { "Content-Type": "text/plain", Connection: "close" });
            res.end("request body too large", () => req.destroy());
            return;
        }
        // Stream the body with a hard byte ceiling. Crossing the limit triggers
        // the immediate refusal above-style teardown; bytes under the limit are
        // buffered and handed to the transport via its pre-parsed-body API so the
        // original request stream semantics stay intact for hono/node-server.
        const buffered = [];
        let total = 0;
        let tooLarge = false;
        for await (const chunk of req) {
            const buf = chunk;
            total += buf.length;
            if (total > maxBodyBytes) {
                tooLarge = true;
                break;
            }
            buffered.push(buf);
        }
        if (tooLarge) {
            res.writeHead(413, { "Content-Type": "text/plain", Connection: "close" });
            res.end("request body too large", () => req.destroy());
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
        await handleMcpPost(opts, HttpTransport, req, res, parsedBody);
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
// Per-request servers built and not yet closed, across this process.
let openRequestServers = 0;
/** How many HTTP requests currently hold a server and a transport (0 when the bridge is idle). */
export function openHttpRequestServers() {
    return openRequestServers;
}
async function handleMcpPost(opts, HttpTransport, req, res, parsedBody) {
    // Stateless streamable HTTP: each POST gets a server and a transport of its
    // own, closed exactly once when the response closes, whenever that is:
    // after the answer, while a handler is still running (the client left), or
    // on an error before anything was written.
    let transport;
    let bridge;
    let closed = false;
    const close = () => {
        if (closed)
            return;
        closed = true;
        if (bridge)
            openRequestServers -= 1;
        void transport?.close().catch(() => { });
        void bridge?.server.close().catch(() => { });
    };
    res.on("close", close);
    try {
        transport = new HttpTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        bridge = buildServer(opts);
        openRequestServers += 1;
        await connectServer(bridge, transport);
        if (closed)
            return; // the client left meanwhile
        // parsedBody comes from our bounded pre-read; the transport's
        // pre-parsed-body path skips reading the (already consumed) request stream.
        await transport.handleRequest(req, res, parsedBody);
    }
    catch (err) {
        log.error("http transport error", { error: String(err) });
        if (!res.headersSent && !res.destroyed)
            res.writeHead(500).end("internal error");
    }
    // A response that closed before the listener was added emits no second "close".
    if (res.destroyed)
        close();
}
