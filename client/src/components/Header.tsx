import { useState, useMemo } from "react";
import { Search, Bell, Sun, Moon, X, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSidebar } from "@/components/ui/sidebar";
import PresenceIndicator from "./PresenceIndicator";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "@/contexts/ThemeContext";
import { useSearchSuggestions } from "@/hooks/useDataQuery";
import { useRecentNotifications } from "@/_core/hooks/useNotifications";

export default function Header() {
  const [searchTerm, setSearchTerm] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { toggleSidebar } = useSidebar();
  const { user } = useAuth();
  const { data: suggestions } = useSearchSuggestions(searchTerm);
  // Real notifications. The badge used to be the literal string "7" while the
  // dropdown underneath said "Keine neuen Benachrichtigungen" — the two could
  // never agree, because one of them was a decoration.
  const notifications = useRecentNotifications(10);

  const userInitials = useMemo(
    () =>
      user?.name
        ?.split(" ")
        .map(n => n[0])
        .join("") || "DB",
    [user?.name]
  );

  // sticky, not fixed. As `fixed inset-x-0 z-50` the header spanned the whole
  // viewport and sat on top of the sidebar's own header (z-10), which made the
  // desktop collapse toggle unclickable. Sticky inside the content column keeps
  // it pinned while scrolling without overlapping anything beside it.
  return (
    <header className="sticky top-0 z-30 h-[60px] shrink-0 border-b bg-background/95 backdrop-blur transition-colors duration-300">
      {/* app-shell, not px-3 sm:px-6: the header, the page content and the
          footer now read their gutter and max-width from the same two custom
          properties, so their content edges line up at every viewport width. */}
      <div className="app-shell flex h-full items-center justify-between gap-2">
        <div className="flex shrink-0 items-center gap-x-2 sm:gap-x-3">
          {/*
            Navigation trigger — opens the off-canvas sidebar sheet.

            `lg:hidden`, not `md:hidden`. useMobile.tsx moved MOBILE_BREAKPOINT
            from 768 to 1024 but this class stayed behind, so from 768px to
            1023px the sidebar had not mounted yet AND the trigger was already
            hidden: iPad Pro 11 portrait (834), iPad Air portrait (820) and any
            split-screen window in that band had no navigation at all. The class
            and the constant now name the same width — keep them in step.
          */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label="Navigation öffnen"
            className="h-9 w-9 rounded-lg text-foreground hover:bg-accent lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="w-9 h-9 bg-primary rounded flex items-center justify-center text-white font-bold text-3xl leading-none pt-0.5 shadow-inner ring-1 ring-white/20">
            DB
          </div>
          <div className="items-baseline hidden md:flex">
            <span className="font-bold tracking-[-0.5px] text-2xl">Bahn</span>
            <span className="text-primary-strong font-bold tracking-[-0.5px] text-2xl ml-1">
              Project Manager
            </span>
          </div>
        </div>

        {/* min-w-0 lets the search shrink instead of pushing the control cluster
          off-screen; below sm it is hidden entirely and the page's own search
          takes over. */}
        <div className="relative mx-2 hidden min-w-0 flex-1 sm:mx-4 sm:block sm:max-w-3xl">
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary-strong" />
            <Input
              value={searchTerm}
              onChange={e => {
                setSearchTerm(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              aria-label="Projekte, Stationen und Prüfer durchsuchen"
            placeholder="Projekte, Stationen, Prüfer durchsuchen…"
              className="pl-11 h-9 bg-muted/50 border-border focus:bg-background focus:border-primary w-full text-sm rounded-lg transition-all"
            />
            {searchTerm && (
              <button
                type="button"
                aria-label="Suche zurücksetzen"
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          {showSuggestions && suggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
              {suggestions.map((s) => (
                <button type="button"
                  key={s}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted/80 transition-colors"
                  onMouseDown={() => {
                    setSearchTerm(s);
                    setShowSuggestions(false);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <div className="hidden sm:block">
            <PresenceIndicator />
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Theme wechseln"
            className="h-9 w-9 rounded-lg text-foreground hover:bg-accent"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                aria-label={
                  notifications.length > 0
                    ? `Benachrichtigungen (${notifications.length} neu)`
                    : "Benachrichtigungen"
                }
                className="relative p-2 h-9 w-9 rounded-lg text-foreground hover:bg-accent"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-bold leading-none text-white">
                    {notifications.length > 9 ? "9+" : notifications.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Benachrichtigungen</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Keine neuen Benachrichtigungen
                </div>
              ) : (
                <ul className="max-h-80 overflow-y-auto">
                  {notifications.map((n) => (
                    <li
                      key={n.id}
                      className="border-b border-border/60 px-3 py-2 last:border-0"
                    >
                      <p className="text-xs font-bold leading-tight">{n.title}</p>
                      <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">
                        {n.message}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Avatar className="h-8 w-8 cursor-pointer ring-2 ring-offset-2 ring-primary/30 hover:ring-primary transition-all">
            <AvatarFallback className="bg-primary text-white text-xs font-bold">
              {userInitials}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
