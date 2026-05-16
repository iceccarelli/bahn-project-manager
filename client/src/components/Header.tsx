import { useState, useMemo } from "react";
import { Search, Bell, Sun, Moon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function Header() {
  const [searchTerm, setSearchTerm] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();

  const userInitials = useMemo(() => 
    user?.name?.split(" ").map(n => n[0]).join("") || "DB",
    [user?.name]
  );

  return (
    <header className="fixed top-0 right-0 left-0 z-50 flex h-[60px] items-center justify-between border-b bg-background/95 px-6 backdrop-blur transition-colors duration-300">
      <div className="flex items-center gap-x-3 flex-shrink-0">
        <div className="w-9 h-9 bg-[#FF0000] rounded flex items-center justify-center text-white font-bold text-3xl leading-none pt-0.5 shadow-inner ring-1 ring-white/20">
          DB
        </div>
        <div className="flex items-baseline hidden md:flex">
          <span className="font-bold tracking-[-0.5px] text-2xl">Bahn</span>
          <span className="text-[#FF0000] font-bold tracking-[-0.5px] text-2xl ml-1">Project Manager</span>
        </div>
      </div>

      <div className="flex-1 max-w-3xl relative mx-4">
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
      </div>

      <div className="flex items-center gap-3">
        <PresenceIndicator />
        
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9 rounded-lg text-foreground hover:bg-accent">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative p-2 h-9 w-9 rounded-lg text-foreground hover:bg-accent">
              <Bell className="h-5 w-5" />
              <span className="absolute -top-0.5 -right-0.5 bg-[#FF0000] text-[9px] px-1.5 rounded-full leading-none flex items-center justify-center min-w-[18px] h-[18px] text-white font-bold">7</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Benachrichtigungen</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="p-4 text-center text-sm text-muted-foreground">Keine neuen Benachrichtigungen</div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Avatar className="h-8 w-8 cursor-pointer ring-2 ring-offset-2 ring-[#FF0000]/30 hover:ring-[#FF0000] transition-all">
          <AvatarFallback className="bg-[#FF0000] text-white text-xs font-bold">{userInitials}</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
