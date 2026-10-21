/**
 * Phone navigation (< 768 px): a bottom tab bar within thumb reach, like the apps people use all day —
 * four destinations, the Anmeldung as the raised centre action, and "Mehr" for everything else (specialist pages,
 * account, connection state, sign-out). Every item is a real link or button with a visible label, a >= 44 px touch
 * target and `aria-current` on the open page; nothing depends on a gesture. From 768 px the rail on the side takes over.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LogOut, MoreHorizontal, Plus } from "lucide-react";
import { useAuth, useIdentity } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import ConnectionBadge from "@/realtime/ConnectionBadge";
import { SERVER_MODE } from "@/realtime/serverApi";
import { NAV_ICONS } from "./navIcons";
import { isActivePath, moreIsActive, moreItems, phoneBarItems } from "./navModel";

const tab = "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium leading-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-safe:transition-colors";

export default function BottomTabBar() {
  const [location, setLocation] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const identity = useIdentity();
  const { logout } = useAuth();
  const moreActive = moreIsActive(location);
  const bar = phoneBarItems();
  const [left, right] = [bar.slice(0, 2), bar.slice(3)];
  const centre = bar[2];

  const link = (item: (typeof bar)[number]) => {
    const active = isActivePath(location, item.path);
    const Icon = NAV_ICONS[item.id];
    return (
      <li key={item.id} className="flex">
        <Link href={item.path} aria-current={active ? "page" : undefined} data-testid={`tab-${item.id}`}
          className={`${tab} flex-1 ${active ? "text-primary-strong" : "text-muted-foreground active:text-foreground"}`}>
          {active && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-b bg-primary" />}
          <Icon className="h-6 w-6" strokeWidth={active ? 2.5 : 1.75} aria-hidden />
          <span>{item.shortLabel}</span>
        </Link>
      </li>
    );
  };

  return (
    <>
      <nav aria-label="Hauptnavigation" data-testid="bottom-nav"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden">
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {left.map(link)}
          {centre && (
            <li className="flex">
              <Link href={centre.path} aria-current={isActivePath(location, centre.path) ? "page" : undefined} data-testid={`tab-${centre.id}`}
                aria-label="Projektanmeldung: neues Projekt anmelden"
                className={`${tab} flex-1 ${isActivePath(location, centre.path) ? "text-primary-strong" : "text-muted-foreground"}`}>
                <span className="grid h-7 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md motion-safe:transition-transform motion-safe:active:scale-95">
                  <Plus className="h-5 w-5" strokeWidth={2.75} aria-hidden />
                </span>
                <span>{centre.shortLabel}</span>
              </Link>
            </li>
          )}
          {right.map(link)}
          <li className="flex">
            <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen} data-testid="tab-more"
              className={`${tab} flex-1 ${moreActive ? "text-primary-strong" : "text-muted-foreground active:text-foreground"}`}>
              {moreActive && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-b bg-primary" />}
              <MoreHorizontal className="h-6 w-6" strokeWidth={moreActive ? 2.5 : 1.75} aria-hidden />
              <span>Mehr</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" data-testid="more-sheet" className="max-h-[85vh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)] md:hidden">
          <SheetHeader className="text-left">
            <SheetTitle>Mehr</SheetTitle>
            <SheetDescription className="sr-only">Weitere Seiten, Konto und Abmelden</SheetDescription>
          </SheetHeader>
          <div className="space-y-1 overflow-auto px-4 pb-4">
            {identity && (
              <Link href="/einstellungen" onClick={() => setMoreOpen(false)} data-testid="more-account"
                className="flex items-center gap-3 rounded-xl border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-10 w-10 border"><AvatarFallback className="bg-primary text-xs font-medium text-white">{identity.initials}</AvatarFallback></Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{identity.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{identity.roleLabel} · {identity.workspaceSummary}</span>
                </span>
              </Link>
            )}
            <ul className="pt-2">
              {moreItems().map(item => {
                const Icon = NAV_ICONS[item.id];
                const active = isActivePath(location, item.path);
                return (
                  <li key={item.id}>
                    <Link href={item.path} onClick={() => setMoreOpen(false)} aria-current={active ? "page" : undefined}
                      className={`flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary/10 font-semibold text-primary-strong" : "hover:bg-accent"}`}>
                      <Icon className="h-5 w-5" aria-hidden />
                      {item.id === "einstellungen" ? "Konto und Einstellungen" : item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {SERVER_MODE && <div className="px-3 py-2"><ConnectionBadge /></div>}
            <button type="button" onClick={() => { setMoreOpen(false); logout(); setLocation("/login", { replace: true }); }}
              className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
              <LogOut className="h-5 w-5" aria-hidden /> Abmelden
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
