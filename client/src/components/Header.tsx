import { useState, useEffect } from "react";
import { Search, Bell, ChevronDown, Plus, User, LogOut, CreditCard, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function Header() {
  const [searchTerm, setSearchTerm] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const mockSuggestions = [
    "Projekt #12345 – BVB-EEA Freigabe",
    "Resource: S3 Bucket eu-central-1",
    "Aktion: Neues Projekt erstellen",
    "Region Nord – Frankfurt",
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 flex items-center px-6 gap-x-4 h-[60px] bg-[#1A1A1A] text-white border-b border-[#FF0000] transition-shadow ${
        scrolled ? "shadow-2xl" : "shadow-md"
      }`}
    >
      {/* DB Logo + Service Name */}
      <div className="flex items-center gap-x-3 flex-shrink-0">
        <div className="w-9 h-9 bg-[#FF0000] rounded flex items-center justify-center text-white font-bold text-3xl leading-none pt-0.5 shadow-inner">
          DB
        </div>
        <div className="flex items-baseline">
          <span className="font-bold tracking-[-0.5px] text-2xl">Bahn</span>
          <span className="text-[#FF0000] font-bold tracking-[-0.5px] text-2xl ml-1">
            Project Manager
          </span>
        </div>
      </div>

      {/* Global Search Bar – DB styled for dark header */}
      <div className="flex-1 max-w-2xl relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/70" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 250)}
            placeholder="Projekte, Ressourcen, Aktionen durchsuchen…"
            className="aws-input pl-10 h-9 bg-white/10 border-white/30 text-white placeholder:text-white/60 focus:bg-white focus:text-[#1A1A1A] focus:border-[#FF0000] w-full text-sm"
          />
        </div>

        {/* Search suggestions dropdown */}
        {showSuggestions && (
          <div className="absolute mt-1 w-full bg-white shadow-2xl border border-gray-200 rounded-md py-1 z-50 max-h-60 overflow-auto text-sm">
            {mockSuggestions.map((sug, i) => (
              <div
                key={i}
                className="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center gap-2 text-gray-700"
              >
                <Search className="h-3 w-3" />
                {sug}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions Button – DB red */}
      <Button className="aws-button flex items-center gap-x-2 bg-[#FF0000] hover:bg-[#E6002B] text-white border-none px-5 py-1.5 text-sm font-medium">
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">Erstellen</span>
      </Button>

      {/* Region Selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="aws-button text-white border-white/30 flex items-center gap-x-1 text-sm hover:bg-white/10"
          >
            <span>eu-central-1</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Region</DropdownMenuLabel>
          <DropdownMenuItem>eu-central-1 (Frankfurt)</DropdownMenuItem>
          <DropdownMenuItem>eu-west-1 (Ireland)</DropdownMenuItem>
          <DropdownMenuItem>us-east-1 (N. Virginia)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Notifications */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="aws-button relative text-white p-2 hover:bg-white/10">
            <Bell className="h-5 w-5" />
            <span className="absolute -top-1 -right-1 bg-[#FF0000] text-[10px] px-1.5 rounded-full leading-none flex items-center justify-center min-w-[17px] h-[17px]">
              3
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel>Benachrichtigungen (3)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="flex flex-col items-start py-3">
            <p className="font-medium">Projekt BVB-EEA freigegeben</p>
            <p className="text-xs text-gray-500">vor 2 Minuten</p>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* User Avatar + Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar className="h-8 w-8 cursor-pointer ring-2 ring-offset-2 ring-[#FF0000]/30 hover:ring-[#FF0000]">
            <AvatarFallback className="bg-[#FF0000] text-white text-xs font-bold">BP</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Mein Konto</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <User className="mr-2 h-4 w-4" />
            Kontoeinstellungen
          </DropdownMenuItem>
          <DropdownMenuItem>
            <CreditCard className="mr-2 h-4 w-4" />
            Abrechnung &amp; Nutzung
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-red-600 focus:text-red-600">
            <LogOut className="mr-2 h-4 w-4" />
            Abmelden
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
