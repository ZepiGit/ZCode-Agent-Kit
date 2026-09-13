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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
  type ListResourcesRequest,
  type ReadResourceRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { buildTools, type ToolContext, toolTextPayload } from "./tools.js";
import { listResources, readResource, type ResourceContext } from "./resources.js";
import { createLogger } from "../util/log.js";
import { redactDeep } from "../security/redact.js";

const log = createLogger("mcp");

export interface BridgeServerOptions {
  toolCtx: ToolContext;
  resourceCtx: ResourceContext;
  serverInfo: { name: string; version: string };
}

function buildServer(opts: BridgeServerOptions): Server {
  const tools = buildTools(opts.toolCtx);
  const server = new Server(opts.serverInfo, {
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false },
      logging: {},
    },
  });

  server.setRequestHandler(ListToolsRequestSchema, async (_req: ListToolsRequest) => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.mutating ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false } : { readOnlyHint: true, idempotentHint: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
    const name = String(req.params?.name ?? "");
    const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
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
        structuredContent: redactDeep(result) as Record<string, unknown>,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("tool failed", { tool: name, error: message });
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (_req: ListResourcesRequest) => ({
    resources: listResources(opts.resourceCtx),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req: ReadResourceRequest) => {
    const uri = String((req.params as { uri?: string })?.uri ?? "");
    try {
      return await readResource(opts.resourceCtx, uri);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(message), { code: -32002 });
    }
  });

  return server;
}

export async function serveStdio(opts: BridgeServerOptions): Promise<void> {
  const server = buildServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("bridge ready on stdio");
  // Keep the process alive until stdin closes (transport handles it).
}

export async function serveHttp(opts: BridgeServerOptions, host: string, port: number): Promise<void> {
  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS disabled: same-origin only; origin checking per security policy.
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}:${port}` && !origin.startsWith("http://127.0.0.1") && !origin.startsWith("http://localhost")) {
      res.writeHead(403).end("origin not allowed");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      // Stateless streamable HTTP: each POST creates a request-scoped transport.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const server = buildServer(opts);
      await server.connect(transport);
      await transport.handleRequest(req, res);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      log.error("http transport error", { error: String(err) });
      if (!res.headersSent) res.writeHead(500).end("internal error");
    }
  });
  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  log.info("bridge ready on http", { host, port, path: "/mcp" });
  const sessionId = randomUUID().slice(0, 8);
  log.info("http bridge instance", { sessionId });
}
