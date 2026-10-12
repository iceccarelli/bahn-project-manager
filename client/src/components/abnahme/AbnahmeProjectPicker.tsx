import { useDeferredValue, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProjects, type Project } from "@/hooks/useDataQuery";
import { normalizeReviewStatus } from "@shared/review-status";

const MAX_RESULTS = 50;

const projectLabel = (p: Pick<Project, "projektnummer" | "station" | "id">) =>
  [p.projektnummer, p.station].filter(Boolean).join(" · ") || `Projekt ${p.id}`;

/**
 * The ITK projects an Abnahme can be bound to: those /psv-itk lists, i.e. with
 * an ITK review that is not "nicht erforderlich". Reads through `useProjects`,
 * the one hook that works in both data planes, so local mode filters the
 * in-browser set and server mode searches on the server — the picker never
 * holds a second copy of the project list.
 */
function ProjectList({ search, selectedId, onPick }: { search: string; selectedId: number | null; onPick: (id: number) => void }) {
  const { data, isLoading } = useProjects({ department: "ITK", search: search || undefined, sortBy: "projektnummer", sortDir: "asc" });
  const projects = useMemo(
    () =>
      data.projects
        .filter((p) =>
          p.reviews?.some((r) => r.department === "ITK" && normalizeReviewStatus(r.status) !== "nicht erforderlich"),
        )
        .slice(0, MAX_RESULTS),
    [data.projects],
  );

  return (
    <CommandList>
      {isLoading && (
        <output className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Projekte werden geladen …
        </output>
      )}
      {!isLoading && <CommandEmpty>Kein ITK-Projekt gefunden.</CommandEmpty>}
      <CommandGroup>
        {projects.map((p) => (
          <CommandItem key={p.id} value={String(p.id)} onSelect={() => onPick(p.id)} className="items-start gap-2">
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${p.id === selectedId ? "opacity-100" : "opacity-0"}`} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{projectLabel(p)}</span>
              {p.projektbeschreibung && <span className="block truncate text-xs text-muted-foreground">{p.projektbeschreibung}</span>}
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}

export function AbnahmeProjectPicker({
  projectId,
  project,
  onChange,
}: {
  projectId: number | null;
  /** Resolved project for `projectId`; null while it loads or when the id is unknown. */
  project: Project | null;
  onChange: (next: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const search = useDeferredValue(input.trim());

  const label = projectId === null ? "Kein Projekt (freie Abnahme)" : project ? projectLabel(project) : `Projekt ${projectId} …`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="abnahme-projekt" className="text-xs font-medium text-muted-foreground">
        Projekt
      </Label>
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id="abnahme-projekt"
              variant="outline"
              // biome-ignore lint/a11y/useSemanticElements: a native <select> cannot host a searchable, server-backed list
              role="combobox"
              aria-expanded={open}
              className="h-9 w-full justify-between gap-2 font-normal sm:w-80"
            >
              <span className="truncate">{label}</span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
            {/* Filtering is the data hook's job (search across Projektnummer, Station, Leitung …), so cmdk's own filter is off. */}
            <Command shouldFilter={false}>
              <CommandInput value={input} onValueChange={setInput} placeholder="Projektnummer, Station, Projektleitung …" />
              <ProjectList
                search={search}
                selectedId={projectId}
                onPick={(id) => {
                  onChange(id);
                  setOpen(false);
                }}
              />
            </Command>
          </PopoverContent>
        </Popover>
        {projectId !== null && (
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Projektbezug entfernen" onClick={() => onChange(null)}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
