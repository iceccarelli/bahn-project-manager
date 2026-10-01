import { describe, expect, it } from "vitest";
import { KeyedCache, scopeKey } from "./keyedCache";

describe("scopeKey", () => {
  it("is order- and duplicate-insensitive, and never collides unrestricted with a list", () => {
    expect(scopeKey(["Kassel", "Frankfurt"])).toBe(scopeKey(["Frankfurt", "Kassel", "Kassel"]));
    expect(scopeKey(null)).toBe("ALL");
    expect(scopeKey(["ALL"])).not.toBe(scopeKey(null));
    expect(scopeKey([])).not.toBe(scopeKey(null));
  });
});

describe("KeyedCache", () => {
  it("shares one load per key across concurrent callers and never crosses keys", async () => {
    const c = new KeyedCache<string>("t", 10_000);
    let loads = 0;
    const load = (v: string) => async () => { loads++; await new Promise(r => setTimeout(r, 20)); return v; };
    const [a1, a2, b] = await Promise.all([c.get("A", load("a")), c.get("A", load("a")), c.get("B", load("b"))]);
    expect([a1, a2, b]).toEqual(["a", "a", "b"]);
    expect(loads).toBe(2);
  });
  it("is bounded", async () => {
    const c = new KeyedCache<number>("t", 10_000, 3);
    for (let i = 0; i < 10; i++) await c.get(`k${i}`, async () => i);
    expect(c.size).toBe(3);
  });
});
