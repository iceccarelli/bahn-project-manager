/**
 * Per-key read-model cache: one SingleFlightCache per key, bounded (LRU), so N users with the same
 * authorization scope / filter set share ONE computation per TTL instead of one per request.
 *
 * Keys MUST encode the caller's authorization scope (see scopeKey()): a value cached for one scope is
 * never served to a different one. That is the whole security argument for caching restricted aggregates.
 */
import { SingleFlightCache } from "./singleFlightCache";

export class KeyedCache<T> {
  private readonly entries = new Map<string, SingleFlightCache<T>>();
  constructor(private readonly name: string, private readonly ttlMs: number, private readonly maxKeys = 500) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    let c = this.entries.get(key);
    if (c) { this.entries.delete(key); this.entries.set(key, c); } // LRU touch
    else {
      c = new SingleFlightCache<T>(this.name, this.ttlMs, load);
      this.entries.set(key, c);
      if (this.entries.size > this.maxKeys) this.entries.delete(this.entries.keys().next().value as string);
    }
    return c.get();
  }
  invalidateAll() { for (const c of this.entries.values()) c.invalidate(); }
  get size() { return this.entries.size; }
}

/** Normalized authorization scope: null (unrestricted) → "ALL"; otherwise the sorted, de-duplicated workspace list. */
export const scopeKey = (workspaces: readonly string[] | null): string =>
  workspaces === null ? "ALL" : `ws:${[...new Set(workspaces)].sort().join("|")}`;
