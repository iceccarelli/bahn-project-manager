/**
 * Multi-instance transport over Redis pub/sub. Each event is PUBLISHed once
 * per scope channel; every app instance SUBSCRIBEs only to channels that have
 * a local subscriber (ref-counted by LocalHub), so an instance with no
 * interested browsers receives nothing.
 *
 * Redis pub/sub is fire-and-forget: a message published while an instance's
 * subscriber connection is down is gone. That is acceptable by design —
 * durability is the outbox + per-aggregate version cursor, and the client
 * detects the gap and resyncs. Redis is transport, not a source of truth.
 */
import type Redis from "ioredis";
import { DomainEventSchema, scopesForEvent, type DomainEvent } from "@shared/domain-events";
import type { ControlChannel, RealtimePublisher, RealtimeSubscriber, Subscription, SubscriptionScope } from "../domain/ports";
import { LocalHub } from "./hub";

const PREFIX = "bahn:evt:";
const CTL = "bahn:ctl:";

export class RedisBus implements RealtimePublisher, RealtimeSubscriber {
  readonly hub: LocalHub;
  private readonly ctlHandlers = new Map<string, (m: unknown) => void>();
  constructor(private readonly pub: Redis, private readonly sub: Redis, private readonly onError: (e: unknown) => void = () => {}) {
    this.hub = new LocalHub({
      // The returned promise settles when Redis has ACKNOWLEDGED the SUBSCRIBE: that is what `ready` means.
      onChannelOpen: c => this.sub.subscribe(PREFIX + c).then(() => undefined, e => { this.onError(e); throw e; }),
      onChannelClose: c => { this.sub.unsubscribe(PREFIX + c).catch(this.onError); },
    });
    this.sub.on("message", (channel: string, payload: string) => {
      try {
        if (channel.startsWith(CTL)) { this.ctlHandlers.get(channel.slice(CTL.length))?.(JSON.parse(payload)); return; }
        const event = DomainEventSchema.parse(JSON.parse(payload));
        this.hub.deliver(channel.slice(PREFIX.length), event);
      } catch (e) { this.onError(e); }
    });
  }

  readonly control: ControlChannel = {
    sendControl: async (node, message) => (await this.pub.publish(CTL + node, JSON.stringify(message))) > 0,
    onControl: async (node, handler) => {
      this.ctlHandlers.set(node, handler);
      await this.sub.subscribe(CTL + node);
      return () => { this.ctlHandlers.delete(node); this.sub.unsubscribe(CTL + node).catch(this.onError); };
    },
  };

  async publish(event: DomainEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const p = this.pub.pipeline();
    for (const c of scopesForEvent(event)) p.publish(PREFIX + c, payload);
    const res = await p.exec();
    const failed = res?.find(([err]) => err);
    if (failed?.[0]) throw failed[0];
  }

  subscribe(scope: SubscriptionScope): Subscription { return this.hub.subscribe(scope); }
}
