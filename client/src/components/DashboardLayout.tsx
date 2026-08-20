import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
  ClipboardCheck,
  LayoutDashboard,
  PanelLeft,
  Table2,
  FileCheck,
  Network,
  History,
  LogOut,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAllProjects } from "@/hooks/useDataQuery";
import Header from "./Header";
import Footer from "./Footer";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: ClipboardCheck, label: "Projektanmeldung", path: "/anmeldung" },
  { icon: Table2, label: "Projekte", path: "/projects" },
  { icon: FileCheck, label: "BVB-EEA", path: "/bvb-eea" },
  { icon: Network, label: "PSV-ITK", path: "/psv-itk" },
  { icon: History, label: "Änderungshistorie", path: "/audit" },
];

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
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  // The count used to be the literal string "1.299 Projekte", which was wrong
  // the moment the Projektanmeldung wizard created project 1299 (making 1,299
  // the *id*, not the total) and wrong again on every import after that.
  const { data } = useAllProjects();
  const projectCount = data?.projects.length ?? null;

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const userInitials = useMemo(() => 
    user?.name?.split(" ").map((n) => n[0]).join("").toUpperCase() || "DB",
    [user?.name]
  );

  return (
    <div className="p-3 space-y-3 border-t border-border/50">
      <div className="flex items-center gap-3 rounded-lg px-1 py-1 w-full group-data-[collapsible=icon]:justify-center">
        <Avatar className="h-9 w-9 border shrink-0">
          <AvatarFallback className="text-xs font-medium bg-primary text-white">
            {userInitials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
          <p className="text-sm font-medium truncate leading-none">
            {user?.name || "Bahn Prüfer"}
          </p>
          <p className="text-xs text-muted-foreground truncate mt-1.5">
            {user?.role === "admin" ? "Admin" : "Prüfer"}
            {projectCount !== null ? ` • ${projectCount.toLocaleString("de-DE")} Projekte` : ""}
          </p>
        </div>
      </div>
      <button type="button"
        onClick={handleLogout}
        className="w-full px-3 py-2 text-sm text-left text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors flex items-center gap-2"
      >
        <LogOut className="h-4 w-4" />
        <span>Abmelden</span>
      </button>
    </div>
  );
}

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
}) {
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) return; // No resize on mobile
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
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
              <SidebarMenu className="px-2 py-1">
                {menuItems.map((item) => {
                  const isActive = location === item.path;
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => setLocation(item.path)}
                        tooltip={item.label}
                        className={`h-10 transition-all font-normal ${
                          isActive ? "text-primary-strong border-l-4 border-primary pl-3" : ""
                        }`}
                      >
                        <item.icon className={`h-4 w-4 ${isActive ? "text-primary-strong" : ""}`} />
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
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors z-50"
              onMouseDown={() => setIsResizing(true)}
            />
          )}
        </div>

        <SidebarInset className="flex flex-col flex-1 min-w-0 bg-background overflow-hidden">
          <Header />
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
      </div>
    </div>
  );
}
