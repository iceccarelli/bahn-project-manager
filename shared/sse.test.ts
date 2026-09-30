import { describe, expect, it } from "vitest";
import { SseParser } from "./sse";
import { decideEvent, isValidScope, scopesForEvent, SeenEvents, slugify } from "./domain-events";

describe("SseParser", () => {
  it("reassembles frames split at arbitrary byte boundaries", () => {
    const p = new SseParser();
    const wire = 'retry: 3000\n\nevent: hello\ndata: {"a":1}\n\n: hb\n\nid: x1\nevent: domain\ndata: {"b":\ndata: 2}\n\n';
    const out = [];
    for (const ch of wire) out.push(...p.feed(ch));
    expect(out.filter(f => f.event !== "comment" && f.event !== "message")).toEqual([
      { event: "hello", data: '{"a":1}' },
      { event: "domain", data: '{"b":\n2}', id: "x1" },
    ]);
    expect(out.some(f => f.event === "comment")).toBe(true); // heartbeats are observable (watchdog)
  });
});

describe("event contract helpers", () => {
  it("decideEvent", () => {
    expect(decideEvent(3, { aggregateVersion: 4, eventType: "project.updated" })).toEqual({ kind: "apply" });
    expect(decideEvent(3, { aggregateVersion: 3, eventType: "project.updated" })).toEqual({ kind: "stale" });
    expect(decideEvent(3, { aggregateVersion: 6, eventType: "project.updated" })).toEqual({ kind: "gap", missingFrom: 4, missingTo: 5 });
    expect(decideEvent(undefined, { aggregateVersion: 1, eventType: "project.created" })).toEqual({ kind: "apply" });
    expect(decideEvent(undefined, { aggregateVersion: 4, eventType: "project.updated" })).toEqual({ kind: "unknown-aggregate" });
  });
  it("scopes: project + workspace(s); a move reaches both workspaces", () => {
    const e = { aggregateType: "project", aggregateId: "12", context: { workspace: "Gießen", workspaceBefore: "Frankfurt" } } as never;
    expect(scopesForEvent(e).sort()).toEqual(["project:12", "workspace:frankfurt", "workspace:giessen"].sort());
    expect(slugify("Saarbrücken")).toBe("saarbrucken");
  });
  it("scope validation rejects wildcards and junk", () => {
    for (const bad of ["*", "project:*", "project:", "admin:1", "project:1;2", "project:" + "x".repeat(70)]) expect(isValidScope(bad)).toBe(false);
    expect(isValidScope("workspace:frankfurt")).toBe(true);
  });
  it("SeenEvents is bounded", () => {
    const s = new SeenEvents(3);
    ["a", "b", "c", "d"].forEach(x => s.seen(x));
    expect(s.seen("a")).toBe(false); // evicted
    expect(s.seen("d")).toBe(true);
  });
});
