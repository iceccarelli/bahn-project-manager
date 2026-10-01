import type { AuditAction, AuditEntityType } from "@shared/audit-contract";
/**
 * Ports. The domain layer depends on these interfaces only — never on MySQL,
 * Redis, HTTP or a realtime vendor. Concrete adapters live in server/infra and
 * server/realtime.
 */
import type { DomainEvent, ScopeKey } from "@shared/domain-events";
import type { ProjectDetail, ProjectListItem, ListProjectsInput } from "@shared/project-contract";
import type { Project, ProjectChecklist, ScheduleSlot } from "../../drizzle/schema";
import type { ChecklistDTO } from "@shared/checklist-contract";
import type { SlotDTO } from "@shared/booking-contract";

// ---- Realtime -------------------------------------------------------------

export interface RealtimePublisher {
  /** Deliver to every subscriber whose scopes include one of scopesForEvent(event). */
  publish(event: DomainEvent): Promise<void>;
}

export interface SubscriptionScope {
  channels: readonly ScopeKey[];
  /** aborting ends the iteration and releases the subscription */
  signal?: AbortSignal;
  /** per-subscriber buffer; on overflow the iterable yields OVERFLOW and ends */
  maxQueue?: number;
}

/** Yielded (once) when a slow consumer lost events: the client must resync. */
export const OVERFLOW = Symbol("realtime.overflow");
export type Delivery = DomainEvent | typeof OVERFLOW;

/**
 * What a subscription hands back. `ready` settles only when the transport has CONFIRMED every channel
 * (Redis: the SUBSCRIBE reply arrived). A caller that must not miss anything published after "now"
 * (the gateway, before it reads the feed head and says hello) awaits it first.
 */
export interface SubscriptionIterator extends AsyncIterator<Delivery> {
  readonly ready: Promise<void>;
  /** add/remove channels on a live subscription; resolves when the added channels are confirmed */
  update(change: { add?: readonly ScopeKey[]; remove?: readonly ScopeKey[] }): Promise<void>;
  readonly channels: ReadonlySet<ScopeKey>;
}
export interface Subscription extends AsyncIterable<Delivery> {
  [Symbol.asyncIterator](): SubscriptionIterator;
}

/** Cross-instance control messages (e.g. "change the scopes of stream X, owned by node N"). Optional transport feature. */
export interface ControlChannel {
  /** send to the node that owns the stream; returns false if the transport is local-only and `node` is not this node */
  sendControl(node: string, message: unknown): Promise<boolean>;
  /** receive control messages addressed to `node`; returns an unsubscribe */
  onControl(node: string, handler: (message: unknown) => void): Promise<() => void>;
}

export interface RealtimeSubscriber {
  subscribe(scope: SubscriptionScope): Subscription;
  /**
   * Called when the shared transport (Redis) came back after an outage. Pub/sub is fire-and-forget, so anything published
   * while this process's subscriber was down is gone: the gateway tells every open stream to catch up from the durable
   * feed immediately instead of waiting for the next event or the periodic poll.
   */
  onTransportRecovered?(cb: () => void): () => void;
  readonly control?: ControlChannel;
}

// ---- Persistence ----------------------------------------------------------

export type IdempotencyClaim =
  | { state: "new" }
  | { state: "replay"; response: unknown }
  | { state: "mismatch" };

export interface AuditRow {
  userId: number | null;
  userName: string;
  entityType: AuditEntityType;
  entityId: number;
  action: AuditAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  /** null for rows that are not an aggregate transition (document actions, authorization grants). */
  eventId: string | null;
  aggregateVersion: number | null;
  traceId: string;
  /** Authorization scope stamped in the writing transaction; null = unrestricted principals only. */
  workspace?: string | null;
  entityLabel?: string | null;
}

/** Everything a project mutation may touch, all inside ONE database transaction. */
export interface ProjectTx {
  /** SELECT … FOR UPDATE */
  lockProject(id: number): Promise<Project | null>;
  /** UPDATE … WHERE id=? AND syncVersion=? ; false when zero rows matched */
  updateVersioned(id: number, expectedVersion: number, set: Partial<Project>): Promise<boolean>;
  insertProject(values: Partial<Project>): Promise<number>;
  // ---- booking aggregate ----
  lockSlot(id: number): Promise<ScheduleSlot | null>;
  /** UPDATE … WHERE id=? AND syncVersion=? ; false when zero rows matched */
  updateSlotVersioned(id: number, expectedVersion: number, set: Partial<ScheduleSlot>): Promise<boolean>;
  // ---- checklist aggregate ----
  lockChecklist(id: number): Promise<ProjectChecklist | null>;
  insertChecklist(values: Partial<ProjectChecklist>): Promise<number>;
  updateChecklistVersioned(id: number, expectedVersion: number, set: Partial<ProjectChecklist>): Promise<boolean>;
  /** replace all answers of a checklist (unique per questionKey) */
  replaceAnswers(checklistId: number, rows: Array<{ questionKey: string; nr: number; answer: string | null; secondary: string | null; comment: string | null }>): Promise<void>;
  checklistDetail(id: number): Promise<ChecklistDTO | null>;
  deleteProject(id: number): Promise<void>;
  watchersOf(projectId: number): Promise<string[]>;
  /** returns the notification id */
  insertNotification(row: { userId: string; kind: string; title: string; body: string | null; link: string; workspace: string | null; eventId: string }): Promise<number>;
  /** SELECT … FOR UPDATE on one department review of a project */
  lockReview(projectId: number, department: string): Promise<{ id: number; status: string | null; prueferName: string | null; datum: Date | null } | null>;
  /** INSERT one department review (unique per project+department); returns its id */
  insertReview(projectId: number, values: { department: string; status: string | null; prueferName: string | null; datum: Date | null }): Promise<number>;
  updateReview(id: number, set: { status?: string | null; prueferName?: string | null; datum?: Date | null }): Promise<void>;
  detail(id: number): Promise<ProjectDetail | null>;
  appendAudit(rows: AuditRow[]): Promise<void>;
  appendEvent(event: DomainEvent): Promise<void>;
  eventsSince(aggregateId: number, afterVersion: number, limit: number): Promise<DomainEvent[]>;
  claimIdempotency(actorId: string, key: string, operation: string, requestHash: string): Promise<IdempotencyClaim>;
  completeIdempotency(actorId: string, key: string, response: unknown): Promise<void>;
}

export interface ProjectStore {
  transaction<T>(fn: (tx: ProjectTx) => Promise<T>): Promise<T>;
  detail(id: number): Promise<ProjectDetail | null>;
  list(
    input: ListProjectsInput,
    visibility: { workspaces: readonly string[] | null },
    opts?: { offset?: number; stationPrefix?: string },
  ): Promise<{ items: ProjectListItem[]; nextCursor: string | null; total?: number }>;
  slotDetail(id: number): Promise<SlotDTO | null>;
  listSlots(range: { from: string; to: string; status?: string }): Promise<Array<ScheduleSlot>>;
  listChecklists(o: { workspaces: readonly string[] | null; principalId: string; isAdmin: boolean; status?: "draft" | "submitted" | "cancelled"; limit: number }): Promise<ChecklistDTO[]>;
  checklistDetail(id: number): Promise<ChecklistDTO | null>;
  versions(ids: number[]): Promise<Map<number, { version: number; bahnhofsmanagement: string | null }>>;
  eventsSince(aggregateId: number, afterVersion: number, limit: number): Promise<DomainEvent[]>;
  shellSummary(workspaces: readonly string[] | null): Promise<{ projectCount: number; lastUpdatedAt: string | null }>;
  /** highest published feedSeq (0 when empty) */
  feedHead(): Promise<number>;
  /** published events with feedSeq in (after, upTo], oldest first */
  changesSince(after: number, limit: number, upTo?: number): Promise<DomainEvent[]>;
}

/** Called after COMMIT to wake the outbox relay; must never throw into the request. */
export type AfterCommit = () => void;
