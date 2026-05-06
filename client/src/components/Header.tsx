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
    "Project #12345 – BVB-EEA Freigabe",
    "Resource: S3 Bucket eu-central-1",
    "Action: Create new project",
    "Region Nord – Frankfurt",
  ];

  return (
    <header
      className={`aws-header fixed top-0 left-0 right-0 z-50 flex items-center px-6 gap-x-4 transition-shadow ${
        scrolled ? "shadow-2xl" : "shadow-md"
      }`}
    >
      {/* Logo + Service Name */}
      <div className="flex items-center gap-x-2 flex-shrink-0">
        <div className="w-8 h-8 bg-[#ff9900] rounded flex items-center justify-center text-white font-bold text-2xl leading-none pt-0.5">
          B
        </div>
        <div className="flex items-baseline">
          <span className="font-semibold tracking-[-0.5px] text-xl">Bahn</span>
          <span className="text-[#ff9900] font-semibold tracking-[-0.5px] text-xl ml-1">
            Project Manager
          </span>
        </div>
      </div>

      {/* Global Search Bar */}
      <div className="flex-1 max-w-2xl relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/70" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 250)}
            placeholder="Search for projects, resources, actions…"
            className="aws-input pl-10 h-9 bg-white/10 border-white/30 text-white placeholder:text-white/60 focus:bg-white focus:text-black w-full text-sm"
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

      {/* Quick Actions Button */}
      <Button className="aws-button flex items-center gap-x-2 bg-[#ff9900] hover:bg-[#e68a00] text-white border-none px-5 py-1.5 text-sm font-medium">
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">Create</span>
      </Button>

      {/* Region Selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="aws-button text-white border-white/30 flex items-center gap-x-1 text-sm"
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
          <Button variant="ghost" className="aws-button relative text-white p-2">
            <Bell className="h-5 w-5" />
            <span className="absolute -top-1 -right-1 bg-red-500 text-[10px] px-1.5 rounded-full leading-none flex items-center justify-center min-w-[17px] h-[17px]">
              3
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel>Notifications (3)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="flex flex-col items-start py-3">
            <p className="font-medium">Project BVB-EEA approved</p>
            <p className="text-xs text-gray-500">2 minutes ago</p>
          </DropdownMenuItem>
          {/* more items possible */}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* User Avatar + Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar className="h-8 w-8 cursor-pointer ring-2 ring-offset-2 ring-[#ff9900]/30 hover:ring-[#ff9900]">
            <AvatarFallback className="bg-[#ff9900] text-white text-xs font-bold">BP</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <User className="mr-2 h-4 w-4" />
            Account settings
          </DropdownMenuItem>
          <DropdownMenuItem>
            <CreditCard className="mr-2 h-4 w-4" />
            Billing &amp; usage
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-red-600 focus:text-red-600">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mobile hamburger is handled by existing SidebarTrigger */}
    </header>
  );
}
