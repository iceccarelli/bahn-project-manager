import { describe, expect, it, vi } from "vitest";
import { ProjectSyncEngine, type SyncResult, type ProjectChange } from "./projectSyncEngine";
import { event, project } from "./testUtils";
import type { ConflictInfo } from "@shared/project-contract";

const empty: SyncResult = { events: [], snapshots: [], deleted: [] };
const noFeed = async () => ({ events: [], cursor: 0, hasMore: false });
const make = (sync = vi.fn(async () => empty), feedFn: (i: { after: number; upTo?: number }) => Promise<{ events: never[] | import("@shared/domain-events").DomainEvent[]; cursor: number; hasMore: boolean }> = noFeed) => {
  const engine = new ProjectSyncEngine({ sync, changes: feedFn });
  const changes: ProjectChange[] = [];
  engine.subscribe(c => changes.push(c));
  return { engine, sync, changes };
};
const flush = () => new Promise(r => setTimeout(r, 0));

describe("ProjectSyncEngine — ordering", () => {
  it("applies the next version and patches only the changed fields", () => {
    const { engine } = make();
    engine.seed(project());
    expect(engine.applyEvent(event(1, 2, { projektstand: { from: "EP", to: "AP" } }))).toBe("applied");
    expect(engine.get(1)).toMatchObject({ version: 2, projektstand: "AP", station: "Köln Hbf" });
  });

  it("drops duplicates by eventId and stale versions", () => {
    const { engine } = make();
    engine.seed(project());
    const e2 = event(1, 2, { kommentar: { from: null, to: "x" } });
    expect(engine.applyEvent(e2)).toBe("applied");
    expect(engine.applyEvent(e2)).toBe("duplicate");
    expect(engine.applyEvent(event(1, 2, { kommentar: { from: null, to: "other" } }))).toBe("stale");
    expect(engine.get(1)!.kommentar).toBe("x");
  });

  it("never applies N+1 when N is missing: recovers from the server, then continues from the right cursor", async () => {
    const e2 = event(1, 2, { projektstand: { from: "EP", to: "AP" } });
    const e3 = event(1, 3, { kommentar: { from: null, to: "c" } });
    const e4 = event(1, 4, { projektleiter: { from: null, to: "L" } });
    const sync = vi.fn(async () => ({ events: [e2, e3], snapshots: [], deleted: [] }));
    const { engine } = make(sync);
    engine.seed(project());

    // e2, e3 lost; e4 arrives
    expect(engine.applyEvent(e4)).toBe("recovering");
    expect(engine.get(1)!.version).toBe(1); // NOT blindly applied
    await flush();
    expect(sync).toHaveBeenCalledWith([{ id: 1, version: 1 }]);
    expect(engine.get(1)).toMatchObject({ version: 4, projektstand: "AP", kommentar: "c", projektleiter: "L" });
    expect(engine.metrics.gaps).toBe(1);
  });

  it("recovers by snapshot when the server says the gap is too large", async () => {
    const snap = project({ version: 40, projektstand: "FA" });
    const { engine } = make(vi.fn(async () => ({ events: [], snapshots: [snap], deleted: [] })));
    engine.seed(project());
    engine.applyEvent(event(1, 41, { kommentar: { from: null, to: "after" } }));
    await flush();
    expect(engine.get(1)).toMatchObject({ version: 41, projektstand: "FA", kommentar: "after" });
    expect(engine.metrics.snapshots).toBe(1);
  });

  it("events arriving during recovery are parked and replayed in order", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const e2 = event(1, 2, { kommentar: { from: null, to: "2" } });
    const e3 = event(1, 3, { kommentar: { from: "2", to: "3" } });
    const e4 = event(1, 4, { kommentar: { from: "3", to: "4" } });
    const { engine } = make(vi.fn(async () => { await gate; return { events: [e2], snapshots: [], deleted: [] }; }));
    engine.seed(project());
    engine.applyEvent(e4);           // gap → recovery starts
    engine.applyEvent(e3);           // arrives mid-recovery → parked
    release();
    await flush(); await flush();
    expect(engine.get(1)).toMatchObject({ version: 4, kommentar: "4" });
  });

  it("a failed recovery does not spin; resync() on reconnect repairs it", async () => {
    const e2 = event(1, 2, { kommentar: { from: null, to: "2" } });
    const e3 = event(1, 3, { kommentar: { from: "2", to: "3" } });
    let fail = true;
    const sync = vi.fn(async () => { if (fail) throw new Error("offline"); return { events: [e2, e3], snapshots: [], deleted: [] }; });
    const { engine } = make(sync);
    engine.seed(project());
    engine.applyEvent(e3);
    await flush(); await flush();
    expect(sync).toHaveBeenCalledTimes(1);           // no retry storm
    expect(engine.get(1)!.version).toBe(1);
    fail = false;
    expect(await engine.resync()).toBe(1);
    expect(engine.get(1)).toMatchObject({ version: 3, kommentar: "3" });
  });

  it("ignores plain updates for aggregates it does not hold; a creation/move-in signals a targeted list refresh (no fabricated row)", () => {
    const { engine, changes } = make();
    expect(engine.applyEvent(event(9, 5, { kommentar: { from: null, to: "x" } }))).toBe("ignored");
    expect(engine.applyEvent(event(9, 1, { station: { from: null, to: "Neu" } }, { eventType: "project.created" }))).toBe("applied");
    expect(engine.get(9)).toBeUndefined();
    expect(changes.at(-1)).toEqual({ kind: "collection-stale", reason: "created", id: 9 });
    engine.applyEvent(event(10, 4, { bahnhofsmanagement: { from: null, to: "Kassel" } }, { context: { workspace: "Kassel", workspaceBefore: "*" } }));
    expect(changes.at(-1)).toEqual({ kind: "collection-stale", reason: "moved-in", id: 10 });
  });

  it("project.removed (moved out of my workspace) removes the row like a delete", () => {
    const { engine, changes } = make();
    engine.seed(project());
    engine.applyEvent(event(1, 2, {}, { eventType: "project.removed", context: { workspace: null, workspaceBefore: "Frankfurt" } }));
    expect(engine.get(1)).toBeUndefined();
    expect(changes.at(-1)).toEqual({ kind: "remove", id: 1 });
  });

  it("delete event removes the aggregate; resync reports deletions", async () => {
    const { engine, changes } = make(vi.fn(async () => ({ events: [], snapshots: [], deleted: [2] })));
    engine.seed(project({ id: 1 })); engine.seed(project({ id: 2 }));
    engine.applyEvent(event(1, 2, {}, { eventType: "project.deleted" }));
    expect(engine.get(1)).toBeUndefined();
    await engine.resync();
    expect(engine.get(2)).toBeUndefined();
    expect(changes.filter(c => c.kind === "remove").map(c => c.id)).toEqual([1, 2]);
  });

  it("seed never moves a version backwards", () => {
    const { engine } = make();
    engine.seed(project({ version: 5, station: "new" }));
    engine.seed(project({ version: 3, station: "old" }));
    expect(engine.get(1)).toMatchObject({ version: 5, station: "new" });
  });
});

describe("ProjectSyncEngine — optimistic edits and conflicts", () => {
  it("overlays a pending edit; a remote edit to ANOTHER field keeps both visible", () => {
    const { engine } = make();
    engine.seed(project());
    engine.optimistic(1, "m1", { projektstand: "FA" });
    expect(engine.get(1)!.projektstand).toBe("FA");
    engine.applyEvent(event(1, 2, { kommentar: { from: null, to: "remote" } }));
    expect(engine.get(1)).toMatchObject({ projektstand: "FA", kommentar: "remote", version: 2 });
    expect(engine.serverVersion(1)).toBe(2);
  });

  it("confirm adopts the authoritative row; the later realtime echo is a no-op", () => {
    const { engine } = make();
    engine.seed(project());
    engine.optimistic(1, "m1", { projektstand: "FA" });
    const own = event(1, 2, { projektstand: { from: "EP", to: "FA" } });
    engine.confirm(1, "m1", project({ version: 2, projektstand: "FA" }));
    expect(engine.pendingCount()).toBe(0);
    expect(engine.applyEvent(own)).toBe("stale");
    expect(engine.get(1)).toMatchObject({ version: 2, projektstand: "FA" });
  });

  it("realtime echo BEFORE the HTTP response is also harmless", () => {
    const { engine } = make();
    engine.seed(project());
    engine.optimistic(1, "m1", { projektstand: "FA" });
    engine.applyEvent(event(1, 2, { projektstand: { from: "EP", to: "FA" } }, { actorId: "me" }));
    engine.confirm(1, "m1", project({ version: 2, projektstand: "FA" }));
    expect(engine.get(1)).toMatchObject({ version: 2, projektstand: "FA" });
  });

  it("rollback on conflict removes the overlay and adopts the server's current row", () => {
    const { engine, changes } = make();
    engine.seed(project());
    engine.optimistic(1, "m1", { projektstand: "FA" });
    const conflict = { currentVersion: 3, current: project({ version: 3, projektstand: "AP" }) } as ConflictInfo;
    engine.rollback(1, "m1", conflict);
    expect(engine.get(1)).toMatchObject({ version: 3, projektstand: "AP" });
    expect(changes.at(-1)).toMatchObject({ kind: "upsert", source: "rollback" });
  });

  it("records who changed what, newest first, for the collaboration UI", () => {
    const { engine } = make();
    engine.seed(project());
    engine.applyEvent(event(1, 2, { projektstand: { from: "EP", to: "AP" } }));
    expect(engine.recentChanges(1)[0]).toMatchObject({ field: "projektstand", from: "EP", to: "AP", actorName: "Markus" });
  });
});

describe("ProjectSyncEngine — collection-level recovery (feed cursor)", () => {
  const feed = (pages: Array<{ events: import("@shared/domain-events").DomainEvent[]; cursor: number; hasMore: boolean }>) => {
    const calls: Array<{ after: number; upTo?: number }> = [];
    let i = 0;
    return { calls, fn: async (input: { after: number; upTo?: number }) => { calls.push(input); return pages[Math.min(i++, pages.length - 1)]!; } };
  };

  it("does nothing without a cursor; the cursor moves only on authoritative reads", async () => {
    const f = feed([{ events: [], cursor: 9, hasMore: false }]);
    const { engine } = make(undefined, f.fn);
    expect(await engine.catchUp()).toBe(0);
    expect(f.calls).toHaveLength(0);
    engine.initCursor(5);
    engine.initCursor(2); // first writer wins
    expect(engine.cursorValue).toBe(5);
    engine.applyEvent(event(1, 2, {})); // a live event must not advance it
    expect(engine.cursorValue).toBe(5);
    await engine.catchUp();
    expect(f.calls[0]).toEqual({ after: 5 });
    expect(engine.cursorValue).toBe(9);
  });

  it("recovers new, deleted, moved-out and updated projects in one pass, paging while hasMore", async () => {
    const e = {
      created: event(20, 1, { station: { from: null, to: "Neu" } }, { eventType: "project.created" }),
      deleted: event(2, 2, {}, { eventType: "project.deleted" }),
      movedOut: event(3, 2, {}, { eventType: "project.removed", context: { workspace: null, workspaceBefore: "Frankfurt" } }),
      updated: event(1, 2, { projektstand: { from: "EP", to: "FA" } }),
      movedIn: event(30, 4, { bahnhofsmanagement: { from: null, to: "Frankfurt" } }, { context: { workspace: "Frankfurt", workspaceBefore: "*" } }),
    };
    const f = feed([
      { events: [e.created, e.deleted], cursor: 12, hasMore: true },
      { events: [e.movedOut, e.updated, e.movedIn], cursor: 15, hasMore: false },
    ]);
    const { engine, changes } = make(undefined, f.fn);
    engine.seed(project({ id: 1 })); engine.seed(project({ id: 2 })); engine.seed(project({ id: 3 }));
    engine.initCursor(10);
    expect(await engine.catchUp(15)).toBe(5);
    expect(f.calls).toEqual([{ after: 10, upTo: 15 }, { after: 12, upTo: 15 }]);
    expect(engine.get(1)).toMatchObject({ version: 2, projektstand: "FA" });
    expect(engine.get(2)).toBeUndefined();
    expect(engine.get(3)).toBeUndefined();
    expect(changes.filter(c => c.kind === "collection-stale").map(c => (c as { reason: string }).reason).sort()).toEqual(["created", "moved-in"]);
    expect(engine.cursorValue).toBe(15);
  });

  it("REGRESSION (found by fault injection): an event received live but parked behind a FAILED recovery is still applied by a later catch-up", async () => {
    const e2 = event(1, 2, { kommentar: { from: null, to: "2" } });
    const e3 = event(1, 3, { kommentar: { from: "2", to: "3" } });
    let fail = true;
    const sync = vi.fn(async () => { if (fail) throw new Error("server busy"); return { events: [e2, e3], snapshots: [], deleted: [] }; });
    const f = feed([{ events: [e2, e3], cursor: 9, hasMore: false }]);
    const { engine } = make(sync, f.fn);
    engine.seed(project()); engine.initCursor(1);
    engine.applyEvent(e3);                 // gap → recovery starts and FAILS; e3 is now "seen" but not applied
    await flush(); await flush();
    expect(engine.get(1)!.version).toBe(1);
    fail = false;
    await engine.catchUp();                // the periodic reconcile must heal it, even though e3 was seen
    expect(engine.get(1)).toMatchObject({ version: 3, kommentar: "3" });
  });

  it("concurrent catch-ups share one run; an already-applied event is not applied twice", async () => {
    const e2 = event(1, 2, { kommentar: { from: null, to: "x" } });
    const f = feed([{ events: [e2], cursor: 8, hasMore: false }]);
    const { engine } = make(undefined, f.fn);
    engine.seed(project()); engine.initCursor(1);
    engine.applyEvent(e2); // arrived live first
    const [a, b] = await Promise.all([engine.catchUp(), engine.catchUp()]);
    expect(f.calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(engine.get(1)!.version).toBe(2);
    expect(engine.metrics.applied).toBe(1);
  });
});

describe("ProjectSyncEngine — review edits ride the same stream", () => {
  const withReviews = () => project({ reviews: [{ id: 7, department: "ITK", status: "offen", prueferName: "Alt", datum: null, updatedAt: "2026-01-01T00:00:00.000Z" }] });
  it("applies review.<Gewerk>.<field> changes to the right review, immutably", () => {
    const { engine } = make();
    engine.seed(withReviews());
    const before = engine.get(1)!.reviews;
    engine.applyEvent(event(1, 2, { "review.ITK.status": { from: "offen", to: "Zustimmung erteilt" } }));
    expect(engine.get(1)!.reviews[0]).toMatchObject({ id: 7, status: "Zustimmung erteilt", prueferName: "Alt" });
    expect(before[0]!.status).toBe("offen");
  });
  it("optimistic review edits overlay and roll back", () => {
    const { engine } = make();
    engine.seed(withReviews());
    engine.optimistic(1, "m1", { "review.ITK.prueferName": "Neu" });
    expect(engine.get(1)!.reviews[0]!.prueferName).toBe("Neu");
    engine.rollback(1, "m1");
    expect(engine.get(1)!.reviews[0]!.prueferName).toBe("Alt");
  });
});
