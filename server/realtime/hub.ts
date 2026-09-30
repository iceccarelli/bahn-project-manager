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
import { OVERFLOW, type Delivery, type RealtimePublisher, type RealtimeSubscriber, type SubscriptionScope } from "../domain/ports";
import { m } from "../observability/metrics";

const DEFAULT_MAX_QUEUE = 256;

interface Sub {
  queue: Delivery[];
  wake: (() => void) | null;
  closed: boolean;
  seen: SeenEvents;
  max: number;
}

export interface HubHooks {
  /** first local subscriber for a channel appeared */
  onChannelOpen?(channel: ScopeKey): void;
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

  subscribe(scope: SubscriptionScope): AsyncIterable<Delivery> {
    const sub: Sub = { queue: [], wake: null, closed: false, seen: new SeenEvents(512), max: scope.maxQueue ?? DEFAULT_MAX_QUEUE };
    const channels = [...new Set(scope.channels)];
    const hub = this;
    return {
      [Symbol.asyncIterator]() {
        for (const c of channels) {
          let set = hub.channels.get(c);
          if (!set) { hub.channels.set(c, (set = new Set())); hub.hooks.onChannelOpen?.(c); }
          set.add(sub);
        }
        m.rtSubscriptions.add(channels.length);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          sub.closed = true;
          for (const c of channels) {
            const set = hub.channels.get(c);
            if (set?.delete(sub) && set.size === 0) { hub.channels.delete(c); hub.hooks.onChannelClose?.(c); }
          }
          m.rtSubscriptions.add(-channels.length);
          sub.wake?.();
        };
        scope.signal?.addEventListener("abort", release, { once: true });
        if (scope.signal?.aborted) release();
        return {
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
  async publish(event: DomainEvent): Promise<void> {
    for (const c of scopesForEvent(event)) this.hub.deliver(c, event);
  }
  subscribe(scope: SubscriptionScope) { return this.hub.subscribe(scope); }
}
