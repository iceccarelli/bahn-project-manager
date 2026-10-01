/**
 * In-process scoped fan-out. Knows nothing about MySQL, HTTP or vendors.
 *
 * Each subscription owns a BOUNDED queue. A consumer that cannot keep up does
 * not stall the publisher and does not grow memory without limit: on overflow
 * its queue is replaced with a single OVERFLOW marker and the iteration ends,
 * which the gateway turns into a `resync` frame. Losing events is therefore
 * always visible to the client, never silent.
 */
import { SeenEvents, scopesForEvent, type DomainEvent, type ScopeKey } from "@shared/domain-events";
import { OVERFLOW, type Delivery, type RealtimePublisher, type RealtimeSubscriber, type Subscription, type SubscriptionIterator, type SubscriptionScope } from "../domain/ports";
import { m } from "../observability/metrics";

const DEFAULT_MAX_QUEUE = 256;

interface Sub {
  queue: Delivery[];
  wake: (() => void) | null;
  closed: boolean;
  seen: SeenEvents;
  max: number;
  channels: Set<ScopeKey>;
}

export interface HubHooks {
  /** first local subscriber for a channel appeared; a returned promise is the transport's confirmation (see `ready`) */
  onChannelOpen?(channel: ScopeKey): void | Promise<void>;
  /** last local subscriber for a channel left */
  onChannelClose?(channel: ScopeKey): void;
}

export class LocalHub {
  private readonly channels = new Map<ScopeKey, Set<Sub>>();
  constructor(private readonly hooks: HubHooks = {}) {}

  get subscriberCount() { let n = 0; for (const s of this.channels.values()) n += s.size; return n; }
  get channelCount() { return this.channels.size; }

  deliver(channel: ScopeKey, event: DomainEvent): void {
    const subs = this.channels.get(channel);
    if (!subs) return;
    for (const s of subs) {
      if (s.closed || s.seen.seen(event.eventId)) continue; // multi-channel duplicate
      if (s.queue.length >= s.max) {
        s.queue = [OVERFLOW];
        s.closed = true;
        m.rtDropped.inc();
      } else {
        s.queue.push(event);
      }
      s.wake?.();
    }
  }

  /** transport confirmation per open channel (shared by every subscriber of that channel) */
  private readonly confirmed = new Map<ScopeKey, Promise<void>>();

  private attach(sub: Sub, c: ScopeKey): Promise<void> {
    sub.channels.add(c);
    let set = this.channels.get(c);
    if (!set) {
      this.channels.set(c, (set = new Set()));
      const p = Promise.resolve(this.hooks.onChannelOpen?.(c)).then(() => undefined);
      p.catch(() => this.confirmed.delete(c)); // the owner of `ready` sees the rejection; do not cache a failure
      this.confirmed.set(c, p);
    }
    set.add(sub);
    m.rtSubscriptions.add(1);
    return this.confirmed.get(c) ?? Promise.resolve();
  }
  private detach(sub: Sub, c: ScopeKey) {
    if (!sub.channels.delete(c)) return;
    const set = this.channels.get(c);
    if (set?.delete(sub) && set.size === 0) { this.channels.delete(c); this.confirmed.delete(c); this.hooks.onChannelClose?.(c); }
    m.rtSubscriptions.add(-1);
  }

  subscribe(scope: SubscriptionScope): Subscription {
    const sub: Sub = { queue: [], wake: null, closed: false, seen: new SeenEvents(512), max: scope.maxQueue ?? DEFAULT_MAX_QUEUE, channels: new Set() };
    const hub = this;
    return {
      [Symbol.asyncIterator](): SubscriptionIterator {
        const ready = Promise.all([...new Set(scope.channels)].map(c => hub.attach(sub, c))).then(() => undefined);
        ready.catch(() => {}); // an un-awaited rejection must not crash the process
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          sub.closed = true;
          for (const c of [...sub.channels]) hub.detach(sub, c);
          sub.wake?.();
        };
        scope.signal?.addEventListener("abort", release, { once: true });
        if (scope.signal?.aborted) release();
        return {
          ready,
          channels: sub.channels,
          async update({ add = [], remove = [] }) {
            if (released) return;
            for (const c of remove) hub.detach(sub, c);
            await Promise.all(add.filter(c => !sub.channels.has(c)).map(c => hub.attach(sub, c)));
          },
          async next(): Promise<IteratorResult<Delivery>> {
            for (;;) {
              const item = sub.queue.shift();
              if (item !== undefined) {
                if (item === OVERFLOW) release();
                return { value: item, done: false };
              }
              if (sub.closed) { release(); return { value: undefined, done: true }; }
              await new Promise<void>(r => { sub.wake = r; });
              sub.wake = null;
            }
          },
          async return(): Promise<IteratorResult<Delivery>> { release(); return { value: undefined, done: true }; },
        };
      },
    };
  }
}

/** Single-process transport: publisher and subscriber share one hub. */
export class InProcessBus implements RealtimePublisher, RealtimeSubscriber {
  readonly hub = new LocalHub();
  /** control messages loop back to this process only */
  private readonly handlers = new Map<string, (m: unknown) => void>();
  readonly control = {
    sendControl: async (node: string, message: unknown) => { const h = this.handlers.get(node); if (!h) return false; h(message); return true; },
    onControl: async (node: string, handler: (m: unknown) => void) => { this.handlers.set(node, handler); return () => { this.handlers.delete(node); }; },
  };
  async publish(event: DomainEvent): Promise<void> {
    for (const c of scopesForEvent(event)) this.hub.deliver(c, event);
  }
  subscribe(scope: SubscriptionScope): Subscription { return this.hub.subscribe(scope); }
}
