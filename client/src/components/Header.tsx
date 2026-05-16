import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Bell, ChevronDown, Plus, Sun, Moon, X, Filter, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PresenceIndicator from "./PresenceIndicator";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";

export default function Header() {
  const [searchTerm, setSearchTerm] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current && currentScrollY > 80) {
        setIsVisible(false);
      } else {
        setIsVisible(true);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const allSuggestions = useMemo(() => [
    "G.011573000.99 – Videoanlage Frankfurt (Main) Süd",
    "Projekt #G.011511006 – Erhöhung Hausbahnsteig Bad Hersfeld (Kassel)",
    "Aktion: Neues Projekt erstellen (ZIM Rollout RB Mitte)",
    "Region: Kassel – Bad Hersfeld Modernisierung VST",
    "EEA: Zustimmung erteilt – Oker (44215)",
    "BS: Engstfeld – Zustimmung erteilt (44287)",
    "ITK: Nachforderung – Grimaldi (44246)",
    "Status: 1096 EEA | 378 ITK | 437 BS (aus Pivot)",
    "Bahnhofsmanagement: Frankfurt – FFM HBF Erneuerung Bahnsteig",
    "Ressource: S3 Bucket eu-central-1 / POS Nord Vermessung",
    "Aktion: BVB-EEA Freigabe I.IP-MI-IW1-AA-001",
    "Offene Prüfungen: 312 | Heute erledigt: 47",
    "G.011520036 – Alzey ZIM Anlage Fachtechnische Abnahme",
    "Koblenz LOS 2 – Generalsanierung Rechter Rhein (AP)",
  ], []);

  const filteredSuggestions = useMemo(() => 
    searchTerm.length > 1 
      ? allSuggestions.filter(sug => sug.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 8)
      : allSuggestions.slice(0, 6),
    [searchTerm, allSuggestions]
  );

  const handleSuggestionClick = (suggestion: string) => {
    setSearchTerm(suggestion);
    setShowSuggestions(false);
    window.dispatchEvent(new CustomEvent('global-search', { detail: suggestion }));
    toast.success(`Suche gestartet: ${suggestion.split(' – ')[0]}`);
  };

  const userInitials = useMemo(() => 
    user?.name?.split(" ").map(n => n[0]).join("") || "G",
    [user?.name]
  );

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-[100] flex items-center px-5 gap-x-3 h-[60px] transition-transform duration-300 ease-in-out bg-background/95 text-foreground border-b border-border backdrop-blur ${
        isVisible ? "translate-y-0" : "-translate-y-[60px]"
      }`}
    >
      <div className="flex items-center gap-x-3 flex-shrink-0">
        <div className="w-9 h-9 bg-[#FF0000] rounded flex items-center justify-center text-white font-bold text-3xl leading-none pt-0.5 shadow-inner ring-1 ring-white/20">
          DB
        </div>
        <div className="flex items-baseline hidden md:flex">
          <span className="font-bold tracking-[-0.5px] text-2xl">Bahn</span>
          <span className="text-[#FF0000] font-bold tracking-[-0.5px] text-2xl ml-1">Project Manager</span>
        </div>
      </div>

      <div className="flex-1 max-w-3xl relative mx-2">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-[#FF0000]" />
          <Input
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="Projekte, Stationen, Prüfer durchsuchen…"
            className="pl-11 h-9 bg-muted/50 border-border focus:bg-background focus:border-[#FF0000] w-full text-sm rounded-lg transition-all"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute mt-1.5 w-full bg-popover shadow-2xl border border-border rounded-xl py-1.5 z-[200] max-h-[340px] overflow-auto text-sm">
            <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground flex items-center gap-2 border-b pb-2 mb-1">
              <Filter className="h-3 w-3" /> {filteredSuggestions.length} Ergebnisse
            </div>
            {filteredSuggestions.map((sug, i) => (
              <div
                key={i}
                onClick={() => handleSuggestionClick(sug)}
                className="px-4 py-[9px] hover:bg-accent cursor-pointer flex items-center gap-2.5 transition-colors border-l-2 border-transparent hover:border-[#FF0000]"
              >
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{sug}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <PresenceIndicator />
        
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9 rounded-lg">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative p-2 h-9 w-9 rounded-lg">
              <Bell className="h-5 w-5" />
              <span className="absolute -top-0.5 -right-0.5 bg-[#FF0000] text-[9px] px-1.5 rounded-full leading-none flex items-center justify-center min-w-[18px] h-[18px] text-white font-bold">7</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Benachrichtigungen</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="max-h-[300px] overflow-auto">
              <div className="p-4 text-center text-sm text-muted-foreground">Keine neuen Benachrichtigungen</div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Avatar className="h-8 w-8 cursor-pointer ring-2 ring-offset-2 ring-[#FF0000]/30 hover:ring-[#FF0000] transition-all">
              <AvatarFallback className="bg-[#FF0000] text-white text-xs font-bold">{userInitials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{user?.name || "Gast"}</span>
                <span className="text-xs text-muted-foreground">{user?.email || ""}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">Abmelden</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
