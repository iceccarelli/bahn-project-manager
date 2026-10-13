import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Info icon with a policy sentence: the same words the docs quote. Shared by the register import and the Prüfbericht links; knows neither. */
export function PolicyHint({ text, label }: { text: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex text-muted-foreground hover:text-foreground" aria-label={`Hinweis: ${label}`}>
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}
