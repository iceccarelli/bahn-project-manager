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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  PanelLeft,
  Table2,
  FileCheck,
  Network,
  History,
  LogOut,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
// DB-branded Header & Footer (perfect integration with Übersichtsliste.xlsm architecture)
import Header from "./Header";
import Footer from "./Footer";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
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
      return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
    } catch {}
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

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function SidebarFooterContent() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const userInitials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "DB";

  const userRole = user?.role === "admin" ? "Admin" : "Prüfer";

  return (
    <div className="p-3 space-y-3 border-t border-border/50">
      <div className="flex items-center gap-3 rounded-lg px-1 py-1 w-full group-data-[collapsible=icon]:justify-center">
        <Avatar className="h-9 w-9 border shrink-0">
          <AvatarFallback className="text-xs font-medium bg-[#FF0000] text-white">
            {userInitials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
          <p className="text-sm font-medium truncate leading-none">
            {user?.name || "Bahn Prüfer"}
          </p>
          <p className="text-xs text-muted-foreground truncate mt-1.5">
            {userRole} • 1.299 Projekte
          </p>
        </div>
      </div>
      <button
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
}: DashboardLayoutContentProps) {
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find((item) => item.path === location);
  const isMobile = useIsMobile();

  const handleToggleSidebar = () => {
    if (isResizing) {
      setIsResizing(false);
    }
    toggleSidebar();
  };

  // Resizable sidebar logic (unchanged, robust)
  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

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
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      {/* DB Header – fixed, auto-hides on scroll down, perfectly integrated with xlsm data & search */}
      <Header />

      {/* Sidebar container (resizable + collapsible) */}
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center border-b border-border/60">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={handleToggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Navigation umschalten"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  {/* DB Logo */}
                  <div className="w-6 h-6 bg-[#FF0000] rounded flex items-center justify-center text-white font-bold text-xl leading-none pt-px">
                    DB
                  </div>
                  <span className="font-semibold tracking-tight truncate text-sm">
                    Bahn Project Manager
                  </span>
                </div>
              ) : null}
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
                      className={`h-10 transition-all font-normal aws-nav-link ${
                        isActive
                          ? "text-[#FF0000] border-l-4 border-[#FF0000] pl-3"
                          : ""
                      }`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-[#FF0000]" : ""}`}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          {/* Sidebar Footer – dynamic user info with logout */}
          <SidebarFooter>
            <SidebarFooterContent />
          </SidebarFooter>
        </Sidebar>

        {/* Resizable handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      {/* Main content area with DB header offset + sticky footer below everything */}
      <SidebarInset className="pt-[60px] transition-[margin-left] duration-200 ease-in-out relative z-10 bg-background flex flex-col min-h-screen">
        {/* Mobile top bar */}
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="tracking-tight text-foreground font-medium">
                {activeMenuItem?.label ?? "Menu"}
              </span>
            </div>
          </div>
        )}

        {/* Content wrapper with flex layout for sticky footer below scrollable tables */}
        <div className="flex-1 flex flex-col">
          <main className="flex-1 p-4 lg:p-6 overflow-auto">
            {children}
          </main>

          {/* Footer is HERE – always below the entire website, navbar, AND any scrollable table (e.g. Projekte Übersicht from Übersichtsliste.xlsm) */}
          <Footer />
        </div>
      </SidebarInset>
    </>
  );
}
