/**
 * The notification center's client: server rows (durable) + live
 * `notification.created` events on notifications:<self>. The Header bell in
 * server mode reads THIS, not the audit trail.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DomainEvent } from "@shared/domain-events";
import { KIND_LABEL, type NotificationDTO, type NotificationKind } from "@shared/notification-contract";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { serverApi } from "./serverApi";
import { useRt } from "./RealtimeProvider";

export class NotificationClientStore {
  private live: NotificationDTO[] = [];
  private listeners = new Set<() => void>();
  private snapshot: NotificationDTO[] = [];
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => this.listeners.delete(cb); };
  get = () => this.snapshot;
  /** a notification received over the stream (deduped by id) */
  apply(e: DomainEvent) {
    if (e.aggregateType !== "notification") return;
    const id = Number(e.aggregateId);
    if (this.live.some(n => n.id === id)) return;
    const c = e.changes;
    this.live = [{ id, kind: (c.kind?.to ?? "system") as NotificationKind, title: c.title?.to ?? "", body: c.body?.to ?? null, link: c.link?.to ?? null, createdAt: e.timestamp, read: false }, ...this.live].slice(0, 100);
    this.snapshot = this.live;
    this.listeners.forEach(l => l());
  }
  /** drop live entries the server list already contains */
  reconcile(serverIds: Set<number>) {
    const next = this.live.filter(n => !serverIds.has(n.id));
    if (next.length !== this.live.length) { this.live = next; this.snapshot = next; this.listeners.forEach(l => l()); }
  }
}

const KEY = ["server", "notifications"] as const;

export function useNotificationCenter() {
  const { notifications: store, retain } = useRt();
  const qc = useQueryClient();
  const live = useSyncExternalStore(store.subscribe, store.get);
  const me = useQuery({ queryKey: ["server", "session"], queryFn: () => serverApi.auth.session.query(), staleTime: 60_000 });
  useEffect(() => (me.data ? retain([`notifications:${me.data.id}`]) : undefined), [retain, me.data]);

  const list = useQuery({ queryKey: [...KEY, "list"], queryFn: () => serverApi.notifications.list.query({ limit: 20 }), staleTime: Infinity });
  const unread = useQuery({ queryKey: [...KEY, "unread"], queryFn: () => serverApi.notifications.unreadCount.query(), staleTime: Infinity });
  useEffect(() => { if (list.data) store.reconcile(new Set(list.data.items.map(i => i.id))); }, [list.data, store]);
  // a live event that reaches us bumps the unread count without a refetch
  void live; // re-render on live arrival; the COUNT is server-owned (refetched on every arrival)
  const items: NotificationDTO[] = [...live, ...(list.data?.items ?? [])].sort((a, b) => b.id - a.id).slice(0, 20);
  const unreadCount = unread.data?.count ?? 0;

  const markRead = useCallback(async (ids: number[] | "all") => {
    await serverApi.notifications.markRead.mutate({ ids });
    await Promise.all([qc.invalidateQueries({ queryKey: KEY }), Promise.resolve(store.reconcile(new Set(live.map(n => n.id))))]);
  }, [qc, store, live]);
  return { items, unreadCount, markRead };
}

const KIND_STYLE: Record<NotificationKind, string> = {
  critical: "bg-red-100 text-red-800", deadline: "bg-amber-100 text-amber-800", assignment: "bg-sky-100 text-sky-800",
  mention: "bg-violet-100 text-violet-800", workflow: "bg-emerald-100 text-emerald-800", system: "bg-muted text-muted-foreground",
};

/** Header bell, server mode: real notification stream, kinds distinguished, unread badge, mark-as-read. */
export function NotificationBell() {
  const { items, unreadCount, markRead } = useNotificationCenter();
  const [, setLocation] = useLocation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label={unreadCount ? `Benachrichtigungen (${unreadCount} ungelesen)` : "Benachrichtigungen"} data-testid="notification-bell" className="relative h-9 w-9 rounded-lg p-2 text-foreground hover:bg-accent">
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span data-testid="notification-badge" className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-bold leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuLabel className="flex items-center justify-between">
          Benachrichtigungen
          {unreadCount > 0 && <button type="button" className="text-2xs font-normal text-primary-strong underline" onClick={() => void markRead("all")}>Alle als gelesen markieren</button>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Keine Benachrichtigungen. Beobachten Sie ein Projekt, um Änderungen zu erhalten.</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map(n => (
              <DropdownMenuItem key={n.id} data-testid="notification-item" data-kind={n.kind} onSelect={() => { if (!n.read) void markRead([n.id]); if (n.link) setLocation(n.link); }} className="flex-col items-start gap-1">
                <div className="flex w-full items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-2xs font-bold ${KIND_STYLE[n.kind]}`}>{KIND_LABEL[n.kind]}</span>
                  {!n.read && <span aria-label="ungelesen" className="h-2 w-2 rounded-full bg-primary" />}
                  <span className="ml-auto text-2xs text-muted-foreground">{new Date(n.createdAt).toLocaleString("de-DE")}</span>
                </div>
                <p className="text-xs font-bold leading-tight">{n.title}</p>
                {n.body && <p className="text-2xs leading-snug text-muted-foreground">{n.body}</p>}
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Follow toggle for a project (recipient set of the notification policy). */
export function WatchToggle({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["server", "watching", projectId], queryFn: () => serverApi.projects.watching.query({ projectId }) });
  const on = !!q.data?.watching;
  return (
    <Button type="button" variant="outline" size="sm" data-testid="watch-toggle" aria-pressed={on} className="h-7 text-2xs"
      onClick={async () => { await serverApi.projects.watch.mutate({ projectId, on: !on }); await qc.invalidateQueries({ queryKey: ["server", "watching", projectId] }); }}>
      {on ? "Beobachtet ✓" : "Beobachten"}
    </Button>
  );
}
