import { describe, expect, it } from "vitest";
import { FreshRead } from "./freshRead";

const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("FreshRead", () => {
  it("10,000 concurrent readers cost a handful of loads, and none gets a value older than its own request", async () => {
    let value = 0, inFlight = 0, maxInFlight = 0;
    const fr = new FreshRead(async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); const at = value; await tick(5); inFlight--; return at; });
    const results: Array<{ asked: number; got: number; valueAtAsk: number }> = [];
    const readers = Array.from({ length: 10_000 }, async (_, i) => {
      await tick(i % 40);                       // arrive spread over ~40 ms while the value keeps changing
      const valueAtAsk = value;
      const got = await fr.read(performance.now());
      results.push({ asked: i, got, valueAtAsk });
    });
    const bump = setInterval(() => value++, 2);
    await Promise.all(readers);
    clearInterval(bump);
    expect(fr.loads).toBeLessThan(40);          // vs 10,000 queries
    expect(maxInFlight).toBe(1);                // never more than one query at a time
    // freshness: the value returned is >= the value that existed when the caller asked
    expect(results.every(r => r.got >= r.valueAtAsk)).toBe(true);
  });
  it("a failing load rejects its callers but does not wedge later reads", async () => {
    let fail = true;
    const fr = new FreshRead(async () => { if (fail) throw new Error("db"); return 1; });
    await expect(fr.read(performance.now())).rejects.toThrow("db");
    fail = false;
    await expect(fr.read(performance.now())).resolves.toBe(1);
  });
});
