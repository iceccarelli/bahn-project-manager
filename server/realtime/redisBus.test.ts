/** Two "instances" sharing one Redis: publish on A, receive on B. Needs TEST_REDIS_URL. */
import { afterAll, describe, expect, it } from "vitest";
import IORedis from "ioredis";
import { RedisBus } from "./redisBus";
import { event } from "../../client/src/realtime/testUtils";

const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)("RedisBus (real Redis)", () => {
  const conns: IORedis[] = [];
  const mk = () => { const c = new IORedis(url!); conns.push(c); return c; };
  afterAll(async () => { await Promise.all(conns.map(c => c.quit().catch(() => {}))); });

  it("fans out across instances, only to interested instances/scopes", async () => {
    const a = new RedisBus(mk(), mk());
    const b = new RedisBus(mk(), mk());
    const c = new RedisBus(mk(), mk());
    const bIter = b.subscribe({ channels: ["project:12"] })[Symbol.asyncIterator]();
    const cIter = c.subscribe({ channels: ["project:99"] })[Symbol.asyncIterator]();
    await new Promise(r => setTimeout(r, 100)); // SUBSCRIBE round trip

    const e = event(12, 2, { kommentar: { from: null, to: "x" } });
    await a.publish(e);
    expect((await bIter.next()).value).toMatchObject({ eventId: e.eventId });
    expect(await Promise.race([cIter.next(), new Promise(r => setTimeout(() => r("none"), 150))])).toBe("none");

    await bIter.return!(); await cIter.return!();
    expect(b.hub.channelCount).toBe(0); // unsubscribed when last local subscriber left
  });

  it("rejects malformed payloads instead of delivering them", async () => {
    const errors: unknown[] = [];
    const b = new RedisBus(mk(), mk(), e => errors.push(e));
    const it = b.subscribe({ channels: ["project:5"] })[Symbol.asyncIterator]();
    await new Promise(r => setTimeout(r, 100));
    await mk().publish("bahn:evt:project:5", '{"not":"an event"}');
    await new Promise(r => setTimeout(r, 100));
    expect(errors.length).toBe(1);
    await it.return!();
  });
});
