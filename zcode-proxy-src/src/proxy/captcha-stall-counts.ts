/**
 * Consecutive-stall counters per pe bundle URL (captcha solver). The same
 * cached pe version can stall every attempt (bad rotated VM variant / stale
 * cache): at the second stall of one URL without a solve in between, `evict`
 * runs (the solver invalidates that URL's CDN memory + disk entry) and the
 * count starts over. A solve clears the URL's count.
 *
 * Bound (ADR-0009 correction 1, spec §7): 1,024 URLs, count only, oldest
 * first, no TTL. A TTL would reset counts and change when the cache evicts;
 * the count bound cannot be reached in one solver generation (≤ 200 solves),
 * where these counters live, so the decisions stay those of the unbounded map.
 */
import { BoundedCollection } from "../runtime/bounded-collection.js";

export const MAX_STALL_COUNTS = 1024;
const STALLS_BEFORE_EVICTION = 2;

/** Only rotated pe bundles (dynamicJS) are counted. */
export function isPeBundleUrl(url: string | null | undefined): url is string {
  return !!url && /dynamicJS\//.test(url);
}

export class StallCounts {
  private readonly counts: BoundedCollection<string, number>;

  constructor(
    private readonly evict: (peUrl: string, stalls: number) => void,
    maxEntries = MAX_STALL_COUNTS,
  ) {
    this.counts = new BoundedCollection<string, number>({ maxEntries });
  }

  /** Counts one stall of `peUrl`. Returns false, counting nothing, for a URL that is not a pe bundle. */
  stalled(peUrl: string | null | undefined): boolean {
    if (!isPeBundleUrl(peUrl)) return false;
    const n = (this.counts.get(peUrl) || 0) + 1;
    this.counts.set(peUrl, n);
    if (n >= STALLS_BEFORE_EVICTION) {
      this.evict(peUrl, n);
      this.counts.delete(peUrl);
    }
    return true;
  }

  /** A solve on `peUrl` succeeded: its stall history is cleared. */
  solved(peUrl: string | null | undefined): void {
    if (peUrl) this.counts.delete(peUrl);
  }

  get size(): number {
    return this.counts.size;
  }
}
