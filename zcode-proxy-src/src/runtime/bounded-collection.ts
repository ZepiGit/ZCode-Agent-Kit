/**
 * Bounded collection (ADR-0009): one in-process LRU with an entry limit, a
 * byte budget, an optional TTL and an injected clock. Lifted from the
 * responses store, which keeps its behaviour by delegating here; every other
 * store that must not grow without limit (the captcha CDN memory cache, the
 * solver's stall counters) takes its bound from this module.
 *
 * Order: iteration order is insertion order and a read re-inserts, so the
 * first key is always the least recently used one and is evicted first.
 * Bounds: after every `set()` the collection holds at most `maxEntries`
 * entries and at most `maxBytes` bytes (sizes as `sizeOf` reports them,
 * recorded once when the value is stored). A value that alone exceeds the
 * budget, or whose size is not a finite non-negative number, is refused and
 * leaves the collection unchanged.
 * TTL: an entry is stale when `now - storedAt > ttlMs` and is dropped on the
 * read that finds it stale. A read does not extend it. Without a TTL entries
 * leave only by eviction or `delete()`.
 *
 * Single-threaded: the JS event loop serialises access.
 */

export interface BoundedCollectionOptions<V> {
  /** Entry limit (default: unlimited). */
  maxEntries?: number;
  /** Byte budget over `sizeOf` of all values (default: unlimited). */
  maxBytes?: number;
  /** Age in ms after which an entry is stale (default: no TTL). */
  ttlMs?: number;
  /** Size of one value in bytes (default: 0, so only the entry limit applies). */
  sizeOf?: (value: V) => number;
  /** Clock in epoch ms (default: Date.now, read at call time). */
  now?: () => number;
}

interface Slot<V> {
  value: V;
  size: number;
  storedAt: number;
}

export class BoundedCollection<K, V> {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly sizeOf: (value: V) => number;
  private readonly now: () => number;
  private readonly map = new Map<K, Slot<V>>();
  private totalBytes = 0;

  constructor(opts: BoundedCollectionOptions<V> = {}) {
    this.maxEntries = opts.maxEntries ?? Number.POSITIVE_INFINITY;
    this.maxBytes = opts.maxBytes ?? Number.POSITIVE_INFINITY;
    this.ttlMs = opts.ttlMs ?? Number.POSITIVE_INFINITY;
    this.sizeOf = opts.sizeOf ?? (() => 0);
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Store `value` under `key` as the most recently used entry, replacing any
   * previous value, then evict the least recently used entries until both
   * bounds hold. Returns whether the value is held afterwards.
   */
  set(key: K, value: V, storedAt: number = this.now()): boolean {
    const size = this.sizeOf(value);
    if (!(Number.isFinite(size) && size >= 0) || size > this.maxBytes) return false;
    this.remove(key);
    this.map.set(key, { value, size, storedAt });
    this.totalBytes += size;
    while (this.map.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.remove(oldest.value);
    }
    return this.map.has(key);
  }

  /** The value under `key`, or undefined when missing or stale. A hit becomes the most recently used entry. */
  get(key: K, at: number = this.now()): V | undefined {
    const slot = this.map.get(key);
    if (!slot) return undefined;
    if (at - slot.storedAt > this.ttlMs) {
      this.remove(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, slot);
    return slot.value;
  }

  delete(key: K): boolean {
    return this.remove(key);
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.map.size;
  }

  /** Bytes currently held, as `sizeOf` reported them when each value was stored. */
  get bytes(): number {
    return this.totalBytes;
  }

  private remove(key: K): boolean {
    const slot = this.map.get(key);
    if (!slot) return false;
    this.totalBytes -= slot.size;
    return this.map.delete(key);
  }
}
