/**
 * Client side of ephemeral presence. State is derived from what the person is
 * actually doing (visibility, input activity, a focused edit control) and
 * reported to the server every 15 s and on every change; the server keeps it in
 * Redis with a TTL. Other clients receive `presence.changed` snapshots over the
 * same stream as data events. Nothing here is persisted anywhere.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { DomainEvent } from "@shared/domain-events";
import { authHeaders } from "./serverApi";
import { useConnectionStatus, useRt } from "./RealtimeProvider";

export type PresenceState = "online" | "away" | "idle" | "viewing" | "editing";
export interface PresenceEntry { userId: string; name: string | null; state: PresenceState; since: string; tabs: number }

const EMPTY: PresenceEntry[] = [];

export class PresenceClientStore {
  private map = new Map<string, PresenceEntry[]>();
  private listeners = new Set<() => void>();
  set(scope: string, entries: PresenceEntry[]) { this.map.set(scope, entries); this.listeners.forEach(l => l()); }
  get(scope: string) { return this.map.get(scope) ?? EMPTY; }
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => this.listeners.delete(cb); };
  /** feed a `presence.changed` event from the stream */
  apply(e: DomainEvent) {
    if (e.aggregateType !== "presence") return;
    try { this.set(e.aggregateId, JSON.parse(e.changes.members?.to ?? "[]") as PresenceEntry[]); } catch { /* malformed snapshot: ignore, next one heals */ }
  }
}

const IDLE_AFTER_MS = 60_000, HEARTBEAT_MS = 15_000;
const tabId = (() => { const b = new Uint8Array(12); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, "0")).join(""); })();

/** module-level activity tracker (one set of listeners regardless of how many scopes report) */
const activity = { lastInput: Date.now(), editing: false, listeners: new Set<() => void>() };
if (typeof window !== "undefined") {
  const touch = () => { activity.lastInput = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, touch, { passive: true });
  const isEditControl = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.id !== "projects-search" && !t.closest("[data-presence-ignore]");
  window.addEventListener("focusin", e => { if (isEditControl(e.target)) { activity.editing = true; activity.listeners.forEach(l => l()); } });
  window.addEventListener("focusout", () => { activity.editing = false; activity.listeners.forEach(l => l()); });
  document.addEventListener("visibilitychange", () => activity.listeners.forEach(l => l()));
}
const currentState = (base: PresenceState): PresenceState =>
  typeof document !== "undefined" && document.hidden ? "away"
  : activity.editing ? "editing"
  : Date.now() - activity.lastInput > IDLE_AFTER_MS ? "idle"
  : base;

async function send(method: "POST" | "DELETE" | "GET", scope: string, state?: PresenceState) {
  const headers = { ...(await authHeaders()), "content-type": "application/json" };
  if (method === "POST") return fetch("/api/realtime/presence", { method, headers, credentials: "include", body: JSON.stringify({ scope, state, tabId }) });
  const q = `scope=${encodeURIComponent(scope)}${method === "DELETE" ? `&tabId=${tabId}` : ""}`;
  return fetch(`/api/realtime/presence?${q}`, { method, headers, credentials: "include", keepalive: method === "DELETE" });
}

/** Report presence in `scope` while mounted, and load the current snapshot. `base` is the state when active. */
export function usePresenceReporter(scope: string | null, base: PresenceState) {
  const { presence } = useRt();
  const last = useRef<PresenceState | null>(null);
  const status = useConnectionStatus();
  // Presence events are ephemeral (not in the change feed), so anything published while the
  // stream was (re)connecting is gone: every time the stream is up, load the current snapshot.
  const up = status.state === "connected";
  useEffect(() => {
    if (!scope || !up) return;
    let stopped = false;
    void send("GET", scope).then(r => (r.ok ? r.json() : null)).then(j => { if (!stopped && j) presence.set(scope, j.members); }).catch(() => {});
    return () => { stopped = true; };
  }, [scope, up, presence]);
  useEffect(() => {
    if (!scope) return;
    let stopped = false;
    const beat = (force = false) => {
      const st = currentState(base);
      if (!force && st === last.current && document.hidden) return;
      last.current = st;
      void send("POST", scope, st).catch(() => {});
    };
    void send("GET", scope).then(r => (r.ok ? r.json() : null)).then(j => { if (!stopped && j) presence.set(scope, j.members); }).catch(() => {});
    beat(true);
    const timer = setInterval(() => beat(true), HEARTBEAT_MS);
    const onChange = () => { if (currentState(base) !== last.current) beat(true); };
    activity.listeners.add(onChange);
    const idleCheck = setInterval(onChange, 5_000);
    // closing the tab never unmounts React: say goodbye on pagehide (keepalive DELETE) instead of lingering for the TTL
    const onPageHide = () => { void send("DELETE", scope).catch(() => {}); };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      stopped = true;
      window.removeEventListener("pagehide", onPageHide);
      clearInterval(timer); clearInterval(idleCheck); activity.listeners.delete(onChange);
      void send("DELETE", scope).catch(() => {});
    };
  }, [scope, base, presence]);
}

export function usePresence(scope: string | null): PresenceEntry[] {
  const { presence } = useRt();
  return useSyncExternalStore(presence.subscribe, () => (scope ? presence.get(scope) : EMPTY));
}

const LABEL: Record<PresenceState, string> = { editing: "bearbeitet", viewing: "sieht zu", online: "online", idle: "inaktiv", away: "abwesend" };

/** Who is in this project right now (server presence; ephemeral). */
export function PresenceStrip({ projectId, selfId }: { projectId: number; selfId?: string }) {
  const scope = `project:${projectId}`;
  usePresenceReporter(scope, "viewing");
  const entries = usePresence(scope);
  const others = entries.filter(e => e.userId !== selfId);
  return (
    <p className="text-xs text-muted-foreground" data-testid="presence-strip" aria-live="polite">
      {others.length === 0 ? "Nur Sie sehen dieses Projekt." : others.map(e => `${e.name ?? "Unbekannt"} ${LABEL[e.state]}`).join(" · ")}
    </p>
  );
}

/** Workspace presence for the page bar: "● 3 online in Frankfurt". */
export function WorkspacePresence({ workspace }: { workspace: string | null }) {
  const scope = workspace ? `workspace:${workspace.normalize("NFKD").replace(/ß/g, "ss").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}` : null;
  usePresenceReporter(scope, "online");
  const entries = usePresence(scope);
  if (!workspace) return null;
  const active = entries.filter(e => e.state !== "away");
  return (
    <span className="text-xs text-muted-foreground" data-testid="workspace-presence">
      ● {active.length} online in {workspace}{active.some(e => e.state === "editing") ? ` · ${active.filter(e => e.state === "editing").length} bearbeiten` : ""}
    </span>
  );
}
