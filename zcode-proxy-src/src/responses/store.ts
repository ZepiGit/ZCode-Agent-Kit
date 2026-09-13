/**
 * In-memory response store for the Responses API's `previous_response_id`.
 *
 * The Responses API is stateful: a client passes `previous_response_id`, and
 * the server (OpenAI) reconstructs the full conversation from that stored
 * response. On a non-OpenAI upstream (GLM Chat Completions) we must emulate
 * this ourselves — store each completed response keyed by id, and on the next
 * request prepend the stored `input[]` + `output[]` history so the upstream
 * sees a complete conversation.
 *
 * Backed by a bounded LRU cache with TTL eviction. Process restart drops
 * everything (documented limitation — OpenAI persists for ~30 days, we can't
 * match that without a persistence layer; in-memory is the P1.0 scope).
 *
 * Thread-safety: single-process; JS event loop serialises access.
 */

import type { ResponsesInputItem, ResponsesOutputItem, ResponsesUsage } from "../translator/responses-types.js";

/** A stored response entry — enough to reconstruct the next turn's history. */
export interface StoredResponse {
  id: string;
  model: string;
  status: "completed" | "incomplete" | "failed";
  input: ResponsesInputItem[];
  output: ResponsesOutputItem[];
  usage?: ResponsesUsage;
  instructions?: string;
  createdAt: number;
  lastAccessedAt: number;
}

export interface ResponseStoreOptions {
  /** Max entries before LRU eviction. Default 1000. */
  maxEntries?: number;
  /** TTL in ms before an entry is considered stale. Default 24h. */
  ttlMs?: number;
  /**
   * Byte budget over all stored entries (approximate serialized size).
   * Default 64 MB. Oversized single entries are refused; entries are evicted
   * oldest-first until the store fits again.
   */
  maxTotalBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/**
 * Bounded LRU + TTL cache of stored responses. Iteration order = insertion
 * order; `get()` re-inserts to refresh LRU position. Stale entries are evicted
 * lazily on access and proactively on `set()` overflow (count AND bytes).
 */
export class ResponseStore {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly maxTotalBytes: number;
  private readonly map = new Map<string, StoredResponse>();
  private totalBytes = 0;

  constructor(opts: ResponseStoreOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  }

  /** Approximate serialized size of an entry (keys + strings). */
  private static byteSize(entry: StoredResponse): number {
    let size = 128; // structural overhead baseline
    try {
      size += JSON.stringify(entry).length;
    } catch {
      // cyclic/unserializable output must not poison the store
      return Number.MAX_SAFE_INTEGER;
    }
    return size;
  }

  /** Store a response. Overwrites on duplicate id. Evicts LRU entries on overflow. */
  set(entry: StoredResponse): void {
    const now = Date.now();
    entry.createdAt = now;
    entry.lastAccessedAt = now;
    const size = ResponseStore.byteSize(entry);
    if (size > this.maxTotalBytes) {
      // A single entry beyond the whole budget is not stored (bounded memory
      // beats remembering one huge transcript).
      return;
    }
    const replaced = this.map.get(entry.id);
    if (replaced) {
      this.totalBytes -= ResponseStore.byteSize(replaced);
      this.map.delete(entry.id);
    }
    this.map.set(entry.id, entry);
    this.totalBytes += size;
    while (this.map.size > this.maxEntries || this.totalBytes > this.maxTotalBytes) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.map.get(oldestKey);
      if (oldest) this.totalBytes -= ResponseStore.byteSize(oldest);
      this.map.delete(oldestKey);
    }
  }

  /**
   * Fetch a stored response. Returns `undefined` when missing or stale.
   * Refreshes LRU position on hit.
   */
  get(id: string): StoredResponse | undefined {
    const entry = this.map.get(id);
    if (!entry) return undefined;
    const now = Date.now();
    if (now - entry.createdAt > this.ttlMs) {
      this.totalBytes -= ResponseStore.byteSize(entry);
      this.map.delete(id);
      return undefined;
    }
    entry.lastAccessedAt = now;
    // Re-insert at the tail so the LRU eviction touches it last.
    this.map.delete(id);
    this.map.set(id, entry);
    return entry;
  }

  delete(id: string): boolean {
    const entry = this.map.get(id);
    if (!entry) return false;
    this.totalBytes -= ResponseStore.byteSize(entry);
    return this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
  }

  size(): number {
    return this.map.size;
  }

  /** Approximate total serialized bytes currently retained (for diagnostics/tests). */
  totalBytesUsed(): number {
    return this.totalBytes;
  }
}
