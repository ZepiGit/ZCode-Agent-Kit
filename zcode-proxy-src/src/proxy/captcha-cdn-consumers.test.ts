import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { makeInterceptor } from "./captcha-happy.js";
import { CaptchaCdnCache } from "./captcha-cdn-cache.js";
import { captchaDiagnostics } from "./captcha-diagnostics.js";

const URL = "https://g.alicdn.com/AliyunCaptcha.js?token=DO_NOT_REPORT";
const BODY = Buffer.from("var sdk = 1;");
const dirs: string[] = [];
function setup(ttlMs = 100) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "captcha-consumers-"));
  dirs.push(directory);
  let now = 1_000;
  const options = { directory, ttlMs, now: () => now };
  const cache = new CaptchaCdnCache(options);
  const window = { Response, Headers };
  const request = (url = URL, method = "GET") => ({ url, method, headers: new Headers() });
  return { cache, options, window, request, time: (value: number) => { now = value; } };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("real CDN interceptor consumers", () => {
  it("keeps rotated bundle call semantics and does not collect argument secrets", async () => {
    const s = setup();
    const source = `var window={btoa:function(value){return value;},atob:function(value){return value;}}; var A=55,r=[1,1],n=0,e=['SYNTHETIC_SECRET',null,window.btoa],f,l,h,o,p,locals={},iterator=function(count){return Array(count).fill(0)},v=function(){return null}; 55==A?(f=r[n++],l=e.pop(),h=e.pop(),o=[],iterator(f).forEach(function(){o.unshift(e.pop())}),p=null===h?l.apply(locals,o):h[l].apply(h,o),r[n++]&&e.push(p)):0; globalThis.result=e.pop();`;
    const interceptor = makeInterceptor(false, { cache: s.cache, fetch: async () => new Response(source) });
    const response = await interceptor.beforeAsyncRequest({ request: s.request('https://g.alicdn.com/dynamicJS/3.29.0/pe.077.fixture.js'), window: s.window });
    const delivered = await response.text();
    const context = vm.createContext({});
    new vm.Script(delivered).runInContext(context);
    expect(context.result).toBe('SYNTHETIC_SECRET');
    expect(context.window.__DBT).toBeUndefined();
    expect(delivered).toBe(source);
  });
  it("persists async misses, shares concurrent fetches, and expires subsequent sync disk promotion", async () => {
    const s = setup();
    let asyncCalls = 0;
    let syncCalls = 0;
    const interceptor = makeInterceptor(false, {
      cache: s.cache,
      fetch: async () => { asyncCalls++; return new Response(BODY); },
    });
    const responses = await Promise.all([1, 2].map(() => interceptor.beforeAsyncRequest({ request: s.request(), window: s.window })));
    expect(await responses[0].text()).toBe(BODY.toString());
    expect(await responses[1].text()).toBe(BODY.toString());
    expect(asyncCalls).toBe(1);
    s.time(1_099);
    const promotedWindow = { Response, Headers };
    const promoted = makeInterceptor(false, {
      cache: new CaptchaCdnCache(s.options),
      syncFetch: () => { syncCalls++; return { status: 200, body: Buffer.from("var sdk = 2;"), headers: {} }; },
    });
    const cached = promoted.beforeSyncRequest({ request: s.request(), window: promotedWindow });
    expect(Buffer.isBuffer(cached.body)).toBe(true);
    expect(cached.body.toString()).toBe(BODY.toString());
    expect(captchaDiagnostics(promotedWindow).scripts[0]).toMatchObject({ fetchedAt: 1_000, source: "disk" });
    s.time(1_100);
    const fresh = promoted.beforeSyncRequest({ request: s.request(), window: promotedWindow });
    expect(fresh.body.toString()).toBe("var sdk = 2;");
    expect(syncCalls).toBe(1);
    expect(new CaptchaCdnCache(s.options).get(URL)?.fetchedAt).toBe(1_100);
  });

  it("persists a cold synchronous worker result for an async consumer", async () => {
    const s = setup();
    const sync = makeInterceptor(false, {
      cache: s.cache,
      syncFetch: () => ({ status: 200, body: BODY, headers: {} }),
    });
    expect(sync.beforeSyncRequest({ request: s.request(), window: s.window }).body).toEqual(BODY);
    const asyncConsumer = makeInterceptor(false, {
      cache: new CaptchaCdnCache(s.options),
      fetch: () => { throw new Error("disk hit must not fetch"); },
    });
    const response = await asyncConsumer.beforeAsyncRequest({ request: s.request(), window: { Response, Headers } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(BODY.toString());
  });

  it("disabled caching forces both consumers to fetch and leaves disk untouched", async () => {
    const s = setup(0);
    let calls = 0;
    const interceptor = makeInterceptor(false, {
      cache: s.cache,
      fetch: async () => { calls++; return new Response(BODY); },
      syncFetch: () => { calls++; return { status: 200, body: BODY, headers: {} }; },
    });
    await interceptor.beforeAsyncRequest({ request: s.request(), window: s.window });
    await interceptor.beforeAsyncRequest({ request: s.request(), window: s.window });
    interceptor.beforeSyncRequest({ request: s.request(), window: s.window });
    interceptor.beforeSyncRequest({ request: s.request(), window: s.window });
    expect(calls).toBe(4);
    expect(fs.readdirSync(s.options.directory)).toEqual([]);
  });

  it("does not publish invalid JavaScript and refetches an invalid cache hit", async () => {
    const s = setup();
    s.cache.put(URL, Buffer.from("function broken(){"));
    let calls = 0;
    const interceptor = makeInterceptor(false, {
      cache: s.cache,
      fetch: async () => { calls++; return new Response(calls === 1 ? "function incomplete(){" : BODY); },
    });
    expect((await interceptor.beforeAsyncRequest({ request: s.request(), window: s.window })).status).toBe(503);
    expect(s.cache.get(URL)).toBeNull();
    const fresh = await interceptor.beforeAsyncRequest({ request: s.request(), window: s.window });
    expect(await fresh.text()).toBe(BODY.toString());
    expect(calls).toBe(2);
  });

  it("bypasses a stalled pe once, then shares its fresh cache entry", async () => {
    const s = setup();
    const url = "https://g.alicdn.com/dynamicJS/fixture/pe.123.js";
    s.cache.put(url, BODY);
    let calls = 0;
    const interceptor = makeInterceptor(true, {
      cache: s.cache,
      fetch: async () => { calls++; return new Response("var freshPe = 1;"); },
    });
    const one = await interceptor.beforeAsyncRequest({ request: s.request(url), window: s.window });
    const two = await interceptor.beforeAsyncRequest({ request: s.request(url), window: s.window });
    expect(await one.text()).toBe("var freshPe = 1;");
    expect(await two.text()).toBe("var freshPe = 1;");
    expect(calls).toBe(1);
  });

  it("keeps egress rejection ahead of warm cache hits and disables redirect following", async () => {
    const s = setup();
    const forbidden = "https://127.0.0.1/private.js";
    s.cache.put(forbidden, BODY);
    const redirects: unknown[] = [];
    const interceptor = makeInterceptor(false, {
      cache: s.cache,
      fetch: async (_url: string, init: RequestInit) => { redirects.push(init.redirect); return new Response(BODY); },
      syncFetch: (_url: string, init: RequestInit) => { redirects.push(init.redirect); return { status: 200, body: BODY, headers: {} }; },
    });
    expect((await interceptor.beforeAsyncRequest({ request: s.request(forbidden), window: s.window })).status).toBe(503);
    expect(interceptor.beforeSyncRequest({ request: s.request(forbidden), window: s.window }).status).toBe(503);
    expect(redirects).toEqual([]);
    await interceptor.beforeAsyncRequest({ request: s.request(), window: s.window });
    s.cache.invalidate(URL);
    interceptor.beforeSyncRequest({ request: s.request(), window: s.window });
    expect(redirects).toEqual(["error", "error"]);
  });

  it("does not cache CDN POSTs or error responses", async () => {
    const s = setup();
    const interceptor = makeInterceptor(false, {
      cache: s.cache,
      fetch: async () => new Response("not a bundle", { status: 403 }),
      syncFetch: () => ({ status: 403, body: Buffer.from("not a bundle"), headers: {} }),
    });
    await interceptor.beforeAsyncRequest({ request: s.request(URL, "POST"), window: s.window });
    await interceptor.beforeAsyncRequest({ request: s.request(), window: s.window });
    interceptor.beforeSyncRequest({ request: s.request(), window: s.window });
    expect(s.cache.get(URL)).toBeNull();
    expect(fs.readdirSync(s.options.directory)).toEqual([]);
  });
});
