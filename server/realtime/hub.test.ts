import { describe, expect, it } from "vitest";
import { InProcessBus } from "./hub";
import { OVERFLOW } from "../domain/ports";
import { event } from "../../client/src/realtime/testUtils";

const take = async (it: AsyncIterator<unknown>, n: number) => {
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) out.push((await it.next()).value);
  return out;
};

describe("InProcessBus", () => {
  it("delivers only to subscribers of a matching scope", async () => {
    const bus = new InProcessBus();
    const ac = new AbortController();
    const p12 = bus.subscribe({ channels: ["project:12"], signal: ac.signal })[Symbol.asyncIterator]();
    const p13 = bus.subscribe({ channels: ["project:13"], signal: ac.signal })[Symbol.asyncIterator]();
    const wsKassel = bus.subscribe({ channels: ["workspace:kassel"], signal: ac.signal })[Symbol.asyncIterator]();
    const wsFfm = bus.subscribe({ channels: ["workspace:frankfurt"], signal: ac.signal })[Symbol.asyncIterator]();
    await bus.publish(event(12, 2, { kommentar: { from: null, to: "x" } }));
    expect(((await take(p12, 1))[0] as { aggregateId: string }).aggregateId).toBe("12");
    expect(((await take(wsFfm, 1))[0] as { aggregateId: string }).aggregateId).toBe("12");
    // p13 and wsKassel must have received nothing
    const none = await Promise.race([p13.next(), wsKassel.next(), new Promise(r => setTimeout(() => r("none"), 50))]);
    expect(none).toBe("none");
    ac.abort();
  });

  it("an event matching two of a subscriber's channels is delivered once", async () => {
    const bus = new InProcessBus();
    const it = bus.subscribe({ channels: ["project:12", "workspace:frankfurt"] })[Symbol.asyncIterator]();
    const e = event(12, 2, { kommentar: { from: null, to: "x" } });
    await bus.publish(e);
    expect((await it.next()).value).toMatchObject({ eventId: e.eventId });
    const second = await Promise.race([it.next(), new Promise(r => setTimeout(() => r("none"), 50))]);
    expect(second).toBe("none");
    await it.return!();
  });

  it("a slow consumer is cut off with OVERFLOW (never silently lossy, never unbounded), and others are unaffected", async () => {
    const bus = new InProcessBus();
    const slow = bus.subscribe({ channels: ["project:12"], maxQueue: 3 })[Symbol.asyncIterator]();
    const fast = bus.subscribe({ channels: ["project:12"], maxQueue: 100 })[Symbol.asyncIterator]();
    for (let v = 2; v < 12; v++) await bus.publish(event(12, v, { kommentar: { from: null, to: String(v) } }));
    expect((await slow.next()).value).toBe(OVERFLOW);
    expect((await slow.next()).done).toBe(true);
    const got = await take(fast, 10);
    expect(got).toHaveLength(10);
    expect(bus.hub.subscriberCount).toBe(1);
    await fast.return!();
    expect(bus.hub.subscriberCount).toBe(0);
    expect(bus.hub.channelCount).toBe(0);
  });

  it("abort releases the subscription", async () => {
    const bus = new InProcessBus();
    const ac = new AbortController();
    const it = bus.subscribe({ channels: ["project:1"], signal: ac.signal })[Symbol.asyncIterator]();
    const pending = it.next();
    ac.abort();
    expect((await pending).done).toBe(true);
    expect(bus.hub.channelCount).toBe(0);
  });
});
