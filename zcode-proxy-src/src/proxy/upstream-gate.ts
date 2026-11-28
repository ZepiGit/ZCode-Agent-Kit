/**
 * upstream-gate — the proxy's own cap on how many model requests it keeps in
 * flight at the upstream at once.
 *
 * The start-plan gateway counts parallel lanes per account and rejects the
 * overflow ("Concurrency limit on the account: N of M lanes were rejected").
 * Retrying into that wall widens the rejection, so the proxy queues its own
 * sends instead: at most `limit` dispatches are live at any moment, the rest
 * wait in arrival order.
 *
 * A slot is held for the WHOLE response, not just its headers: a stream that
 * the client reads for a minute still occupies a lane upstream. Every release
 * path is covered — body end, body cancel, a dispatch that throws, and a
 * queued acquire whose client went away.
 */

/** How many model dispatches run at once by default. 0 disables the cap. */
export const DEFAULT_MAX_PARALLEL = 6;

/** The env override; `0` means unlimited, junk falls back to the default. */
export const MAX_PARALLEL_ENV = "ZCODE_PROXY_MAX_PARALLEL";

export interface UpstreamGateStats {
  /** The configured cap; 0 = unlimited. */
  limit: number;
  /** Slots currently held. */
  active: number;
  /** Acquires waiting for a slot. */
  queued: number;
  /** Highest `active` seen since start (how close the cap gets). */
  peak: number;
}

export interface UpstreamGate {
  acquire(signal?: AbortSignal): Promise<() => void>;
  /** Wrap `resp` so `release` runs when its body ends, is cancelled, or is absent. */
  holdUntilBodyEnds(resp: Response, release: () => void): Response;
  stats(): UpstreamGateStats;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  detach?: () => void;
}

/** Parse `ZCODE_PROXY_MAX_PARALLEL`: a non-negative integer, else the default. */
export function parseMaxParallel(raw: string | undefined = process.env[MAX_PARALLEL_ENV]): number {
  const value = raw?.trim();
  if (value === undefined || value === "") return DEFAULT_MAX_PARALLEL;
  if (!/^\d{1,4}$/.test(value)) return DEFAULT_MAX_PARALLEL;
  return Number(value);
}

export function createUpstreamGate(limit: number): UpstreamGate {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  let active = 0;
  let peak = 0;
  const waiters: Waiter[] = [];

  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return; // a double release must not free someone else's slot
      released = true;
      active -= 1;
      drain();
    };
  };

  const drain = (): void => {
    while (waiters.length > 0 && (cap === 0 || active < cap)) {
      const waiter = waiters.shift()!;
      waiter.detach?.();
      active += 1;
      peak = Math.max(peak, active);
      waiter.resolve(makeRelease());
    }
  };

  const acquire = async (signal?: AbortSignal): Promise<() => void> => {
    if (signal?.aborted) throw new Error("upstream gate acquire aborted");
    if (cap === 0) {
      active += 1;
      peak = Math.max(peak, active);
      return makeRelease();
    }
    if (active < cap && waiters.length === 0) {
      active += 1;
      peak = Math.max(peak, active);
      return makeRelease();
    }
    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (signal) {
        const onAbort = (): void => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("upstream gate acquire aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.detach = () => signal.removeEventListener("abort", onAbort);
      }
      waiters.push(waiter);
    });
  };

  const holdUntilBodyEnds = (resp: Response, release: () => void): Response => {
    if (!resp.body) {
      release();
      return resp;
    }
    const source = resp.body.getReader();
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      release();
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await source.read();
          if (chunk.done) {
            finish();
            controller.close();
          } else {
            controller.enqueue(chunk.value);
          }
        } catch (err) {
          finish();
          controller.error(err);
        }
      },
      async cancel(reason) {
        finish();
        try { await source.cancel(reason); } catch { /* client is gone; nothing to report */ }
      },
    });
    return new Response(body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
    });
  };

  const stats = (): UpstreamGateStats => ({ limit: cap, active, queued: waiters.length, peak });

  return { acquire, holdUntilBodyEnds, stats };
}

let shared: UpstreamGate | undefined;

/** The process-wide gate used by every model route. */
export function upstreamGate(): UpstreamGate {
  shared ??= createUpstreamGate(parseMaxParallel());
  return shared;
}

/** Test seam: forget the shared gate so the next caller re-reads the env. */
export function resetUpstreamGate(): void {
  shared = undefined;
}
