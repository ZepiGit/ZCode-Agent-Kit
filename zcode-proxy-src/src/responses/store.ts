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

import { BoundedCollection } from "../runtime/bounded-collection.js";
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
 * Bounded LRU + TTL cache of stored responses, held in the shared bounded
 * collection (runtime/bounded-collection.ts). `get()` refreshes the LRU
 * position. Stale entries are evicted lazily on access and proactively on
 * `set()` overflow (count AND bytes).
 */
export class ResponseStore {
  private readonly entries: BoundedCollection<string, StoredResponse>;

  constructor(opts: ResponseStoreOptions = {}) {
    this.entries = new BoundedCollection<string, StoredResponse>({
      maxEntries: opts.maxEntries ?? DEFAULT_MAX_ENTRIES,
      ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
      maxBytes: opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
      sizeOf: ResponseStore.byteSize,
    });
  }

  /** Serialized UTF-8 byte size of an entry (ZAK-014: bytes, not UTF-16 code units). */
  private static byteSize(entry: StoredResponse): number {
    let size = 128; // structural overhead baseline
    try {
      size += Buffer.byteLength(JSON.stringify(entry), "utf8");
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
    // A single entry beyond the whole budget is not stored (bounded memory
    // beats remembering one huge transcript); the collection refuses it.
    this.entries.set(entry.id, entry, now);
  }

  /**
   * Fetch a stored response. Returns `undefined` when missing or stale.
   * Refreshes LRU position on hit.
   */
  get(id: string): StoredResponse | undefined {
    const now = Date.now();
    const entry = this.entries.get(id, now);
    if (entry) entry.lastAccessedAt = now;
    return entry;
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  /** Approximate total serialized bytes currently retained (for diagnostics/tests). */
  totalBytesUsed(): number {
    return this.entries.bytes;
  }
}
