import { describe, expect, it } from "vitest";
import { SingleFlightCache } from "./singleFlightCache";

describe("SingleFlightCache", () => {
  it("50 concurrent cold requests → exactly one load", async () => {
    let loads = 0;
    const c = new SingleFlightCache("t", 1000, async () => { loads++; await new Promise(r => setTimeout(r, 20)); return 42; });
    const r = await Promise.all(Array.from({ length: 50 }, () => c.get()));
    expect(new Set(r)).toEqual(new Set([42]));
    expect(loads).toBe(1);
  });
  it("serves stale immediately after TTL while one background refresh runs", async () => {
    let now = 0, loads = 0, release!: () => void;
    const gate = () => new Promise<void>(r => (release = r));
    const c = new SingleFlightCache("t2", 100, async () => { loads++; if (loads > 1) await gate(); return loads; }, 10_000, () => now);
    expect(await c.get()).toBe(1);
    now = 500;
    const [a, b, d] = await Promise.all([c.get(), c.get(), c.get()]); // returns instantly with stale
    expect([a, b, d]).toEqual([1, 1, 1]);
    expect(loads).toBe(2);         // one refresh started, not three
    release(); await new Promise(r => setTimeout(r, 5));
    expect(await c.get()).toBe(2);
  });
  it("a failing refresh keeps serving the previous value", async () => {
    let now = 0, fail = false;
    const c = new SingleFlightCache("t3", 100, async () => { if (fail) throw new Error("db down"); return "ok"; }, 10_000, () => now);
    await c.get(); fail = true; now = 500;
    expect(await c.get()).toBe("ok");
    await new Promise(r => setTimeout(r, 5));
    expect(await c.get()).toBe("ok");
  });
  it("invalidate forces a refresh on next read", async () => {
    let n = 0; const c = new SingleFlightCache("t4", 60_000, async () => ++n);
    await c.get(); c.invalidate(); await c.get(); await new Promise(r => setTimeout(r, 5));
    expect(await c.get()).toBe(2);
  });
});
