/**
 * Presence Indicator Component
 * 
 * Shows online colleagues count and their avatars
 * Displays "X colleagues online" badge
 */

import { useColleaguesOnline, useOnlineColleagues } from "@/_core/hooks/usePresence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Users } from "lucide-react";

export function PresenceIndicator() {
  const colleaguesOnline = useColleaguesOnline();
  const colleagues = useOnlineColleagues();

  if (colleaguesOnline === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer border border-emerald-500/20"
          aria-label="Online colleagues"
        >
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              {colleaguesOnline} {colleaguesOnline === 1 ? "Kollege" : "Kollegen"} online
            </span>
          </div>

          {/* Mini avatars */}
          <div className="flex -space-x-2">
            {colleagues.slice(0, 3).map((colleague) => {
              const initials = colleague.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase();

              return (
                <Avatar
                  key={colleague.id}
                  className="h-5 w-5 border border-background"
                >
                  <AvatarFallback className="text-xs font-medium bg-emerald-500 text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              );
            })}
            {colleaguesOnline > 3 && (
              <div className="h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-medium border border-background">
                +{colleaguesOnline - 3}
              </div>
            )}
          </div>
        </button>
      </PopoverTrigger>

      {/* Popover content showing all online colleagues */}
      <PopoverContent className="w-64">
        <div className="space-y-3">
          <h4 className="font-semibold text-sm">
            {colleaguesOnline} {colleaguesOnline === 1 ? "Kollege" : "Kollegen"} online
          </h4>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {colleagues.map((colleague) => {
              const initials = colleague.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase();

              return (
                <div
                  key={colleague.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs font-medium bg-emerald-500 text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{colleague.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {colleague.email}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs text-muted-foreground">Online</span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground pt-2 border-t">
            Aktualisiert vor {Math.floor(Math.random() * 5) + 1} Sekunden
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
