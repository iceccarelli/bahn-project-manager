import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AskBahn } from "@/components/agent/AskBahn";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import { LogOut, PanelLeft, Plus } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth, useIdentity } from "@/_core/hooks/useAuth";
import { useShellSummary } from "@/hooks/useShellSummary";
import { SERVER_MODE } from "@/realtime/serverApi";
import ConnectionBadge from "@/realtime/ConnectionBadge";
import LegacyPlaneNotice from "@/realtime/LegacyPlaneNotice";
import Header from "./Header";
import Footer from "./Footer";
import BottomTabBar from "./BottomTabBar";
import { NAV_ICONS } from "./navIcons";
import { NAV_ITEMS, isActivePath } from "./navModel";

// One definition for the side rail and the phone's bottom bar (navModel.ts)
const menuItems = NAV_ITEMS.map(i => ({ icon: NAV_ICONS[i.id], label: i.label, path: i.path }));

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      return saved ? Number.parseInt(saved, 10) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  return (
    <SidebarProvider
      // a rail of icons below 1280 px, icon + label above it; the person's own toggle wins afterwards
      defaultOpen={typeof window === "undefined" || window.innerWidth >= 1280}
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

function SidebarFooterContent() {
  const { logout } = useAuth();
  const identity = useIdentity();
  const [, navigate] = useLocation();
  // The count used to be the literal string "1.299 Projekte", which was wrong
  // the moment the Projektanmeldung wizard created project 1299 (making 1,299
  // the *id*, not the total) and wrong again on every import after that.
  const { projectCount } = useShellSummary();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="p-3 space-y-3 border-t border-border/50">
      {identity && (
        <Link href="/einstellungen" data-testid="sidebar-account"
          aria-label={`Konto und Einstellungen: ${identity.displayName}, ${identity.roleLabel}`}
          title={[identity.displayName, identity.email, identity.roleLabel, identity.workspaceSummary].filter(Boolean).join(" · ")}
          className="flex items-center gap-3 rounded-lg px-1 py-1 w-full hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:justify-center">
          <Avatar className="h-9 w-9 border shrink-0">
            <AvatarFallback className="text-xs font-medium bg-primary text-white">
              {identity.initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-medium truncate leading-none" data-testid="sidebar-account-name">{identity.displayName}</p>
            <p className="text-xs text-muted-foreground truncate mt-1.5" data-testid="sidebar-account-role">
              {identity.roleLabel}
              {projectCount !== null ? ` • ${projectCount.toLocaleString("de-DE")} Projekte` : ""}
            </p>
          </div>
        </Link>
      )}
      {SERVER_MODE && <div className="px-1 group-data-[collapsible=icon]:hidden"><ConnectionBadge /></div>}
      <button type="button"
        onClick={handleLogout}
        aria-label="Abmelden" title="Abmelden"
        className="w-full px-3 py-2 text-sm text-left text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors flex items-center gap-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        <span className="group-data-[collapsible=icon]:hidden">Abmelden</span>
      </button>
    </div>
  );
}

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: {
  children: React.ReactNode;
  /** The real setter, so the keyboard handler can read the current width. */
  setSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) return; // No resize on mobile
    // pointermove, not mousemove: a touch or pen drag never produced a
    // mousemove, so the handle was mouse-only on an iPad.
    const handleMouseMove = (e: PointerEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("pointermove", handleMouseMove);
      document.addEventListener("pointerup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("pointermove", handleMouseMove);
      document.removeEventListener("pointerup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth, isMobile]);

  return (
    <div className="flex min-h-screen w-full bg-background overflow-hidden">
      {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto, which
          refuses to shrink below its content's intrinsic width. With a 14-column
          project table inside, this row measured 1632px wide on a 375px phone
          and the parent's overflow-hidden simply clipped it. */}
      <div className="relative flex flex-1 min-w-0">
        <div className="relative" ref={sidebarRef}>
          <Sidebar
            collapsible="icon"
            className="border-r-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border"
            disableTransition={isResizing}
          >
            <SidebarHeader className="h-16 justify-center border-b border-border/60">
              <div className="flex items-center gap-3 px-2 transition-all w-full">
                <button
                  type="button"
                  onClick={toggleSidebar}
                  aria-label={isCollapsed ? "Navigation ausklappen" : "Navigation einklappen"}
                  aria-expanded={!isCollapsed}
                  className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                >
                  <PanelLeft className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </button>
                {!isCollapsed && (
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 bg-primary rounded flex items-center justify-center text-white font-bold text-xl leading-none pt-px">
                      DB
                    </div>
                    <span className="font-semibold tracking-tight truncate text-sm">
                      Bahn Project Manager
                    </span>
                  </div>
                )}
              </div>
            </SidebarHeader>

            <SidebarContent className="gap-0">
              {/* The one primary action, always in reach (icon-only while the rail is collapsed) */}
              <div className="px-2 pb-1 pt-3">
                <button type="button" onClick={() => setLocation("/anmeldung")} data-testid="rail-new"
                  aria-label="Neues Projekt anmelden" title="Neues Projekt anmelden"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm outline-none hover:bg-[hsl(354_100%_32%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-safe:transition-colors motion-safe:active:scale-[0.98]">
                  <Plus className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden />
                  {!isCollapsed && <span>Projekt anmelden</span>}
                </button>
              </div>
              <SidebarMenu className="px-2 py-1">
                {menuItems.map((item) => {
                  const isActive = isActivePath(location, item.path);
                  return (
                    <SidebarMenuItem key={item.path}>
                      {/* aria-current, because `isActive` only produced a colour and a left
                          border. Six nav items announced identically and a screen-reader
                          user had no way to tell which page was open. */}
                      <SidebarMenuButton
                        isActive={isActive}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setLocation(item.path)}
                        tooltip={item.label}
                        className={`h-11 font-normal motion-safe:transition-colors ${
                          isActive ? "bg-primary/10 font-semibold text-primary-strong" : ""
                        }`}
                      >
                        <item.icon className={`!h-5 !w-5 ${isActive ? "text-primary-strong" : ""}`} strokeWidth={isActive ? 2.5 : 1.75} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarContent>

            <SidebarFooter>
              <SidebarFooterContent />
            </SidebarFooter>
          </Sidebar>

          {!isCollapsed && (
            /* A bare <div> with onMouseDown: no role, no tabIndex, no keyboard
               handler, and mouse events only — so it was unusable both by
               keyboard and by touch on an iPad. It is a separator, it is
               focusable, and the arrow keys move it. */
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Breite der Seitenleiste anpassen"
              tabIndex={0}
              className="absolute top-0 right-0 z-50 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/20 focus-visible:bg-primary/40 focus-visible:outline-none"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setIsResizing(true);
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 32 : 8;
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  setSidebarWidth((w) => Math.max(MIN_WIDTH, w - step));
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  setSidebarWidth((w) => Math.min(MAX_WIDTH, w + step));
                }
              }}
            />
          )}
        </div>

        <SidebarInset className="flex flex-col flex-1 min-w-0 bg-background overflow-hidden pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0">
          <Header />
          <LegacyPlaneNotice />
          {/* No mt-[60px] any more: the header is sticky inside this column
              rather than fixed to the viewport, so it occupies real space. */}
          {/* Vertical padding here, horizontal padding on `app-shell` only.
              It used to be `p-4 lg:p-6` *plus* an inner container that added
              another 1-2rem, so the page content sat 32-56px from the column
              edge while the header sat at 12-24px. One gutter now, shared with
              the header and the footer. */}
          <main className="flex-1 min-w-0 w-full overflow-auto py-4 lg:py-6">
            <div className="app-shell">{children}</div>
          </main>
          <Footer />
        </SidebarInset>
        {/* Fixed to the viewport, so it belongs to the layout rather than to any
            one page — every route can be asked about. */}
        {/* Ask Bahn answers from a browser-local snapshot; the server build has none, so it is not offered there until it is server-backed. */}
        {!SERVER_MODE && <AskBahn />}
        <BottomTabBar />
      </div>
    </div>
  );
}
