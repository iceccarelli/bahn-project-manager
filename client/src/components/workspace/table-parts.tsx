/**
 * The table parts the three project surfaces share.
 *
 * Projekte, BVB-EEA and PSV-ITK show the same records through different
 * filters. When each page owned its own sort header, its own editable cell and
 * its own Kommentar dialog, "the same UI" meant "three implementations that
 * happen to look alike today" — and they would not have looked alike for long.
 * These are defined once and imported by all three, so a fix to the focus ring
 * or the accessible name lands everywhere at once.
 *
 * Nothing here holds page state. Sorting, filtering and selection stay with the
 * page; these render and report.
 */
import { useState } from "react";
import { ArrowUpDown, ExternalLink, Info, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { projectLinkUrl } from "@shared/project-link";

/** Every icon button in a row: same size, same ring, same hover. */
const ROW_BUTTON =
  "flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * A cell you click to edit.
 *
 * A <button>, not a <span onClick>. As a span it was unreachable by keyboard,
 * invisible to assistive tech and had no focus ring — 1,298 rows x 6 editable
 * cells that only a mouse could ever open.
 */
export function InlineEditCell({
  value,
  onSave,
  label,
  className = "",
}: {
  value: string | null;
  onSave: (val: string) => void;
  /** What this cell holds, e.g. "Projektstand" — used for the accessible name. */
  label: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || "");
  if (editing) {
    return (
      <input
        aria-label={`${label} bearbeiten`}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => {
          if (editValue !== (value || "")) onSave(editValue);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (editValue !== (value || "")) onSave(editValue);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        className={`w-full border-b border-primary/50 bg-transparent text-xs outline-none focus:border-primary ${className}`}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setEditValue(value || "");
        setEditing(true);
      }}
      aria-label={`${label} bearbeiten${value ? `, aktuell ${value}` : ", derzeit leer"}`}
      className={`-mx-1 w-full cursor-pointer rounded px-1 py-0.5 text-left transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      {value || "-"}
    </button>
  );
}

export interface SortHeaderProps {
  column: string;
  label: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (column: string) => void;
  className?: string;
}

/**
 * A sortable column header.
 *
 * aria-sort on the <th> and a real <button> inside it. The whole cell used to
 * be a click handler on a non-interactive element: no keyboard access, and a
 * screen reader had no way to know the table was sorted at all.
 */
export function SortHeader({
  column,
  label,
  sortBy,
  sortDir,
  onSort,
  className = "",
}: SortHeaderProps) {
  const isActive = sortBy === column;
  return (
    <th
      scope="col"
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={`whitespace-nowrap border-b px-4 py-3 text-left font-semibold text-muted-foreground ${className}`}
    >
      {/*
        An explicit name. "Station, Schaltfläche" tells a screen-reader user
        nothing about what pressing it does, and the column also holds 511
        editable cells whose names begin with the same word — so the header was
        indistinguishable from its own column, to assistive tech and to a test
        harness alike. aria-sort above still carries the current direction.
      */}
      <button
        type="button"
        aria-label={`Nach ${label} sortieren`}
        onClick={() => onSort(column)}
        className="inline-flex select-none items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {label}
        <ArrowUpDown
          className={`h-3 w-3 transition-opacity ${isActive ? "text-primary-strong opacity-100" : "opacity-0"}`}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}

/** The fields the Kommentar dialog writes. Narrower than Project on purpose. */
export interface CommentableProject {
  id: number;
  projektnummer?: string | null;
  kommentar?: string | null;
  projektLink?: string | null;
}

/**
 * Kommentar and Projektlink for one project.
 *
 * Both fields write on blur through the page's own applyEdit, so they are
 * optimistic, rolled back on refusal, and audited exactly like every other
 * edit. The link only renders as a link when it parses as one.
 */
export function ProjectCommentDialog({
  project,
  onEdit,
}: {
  project: CommentableProject;
  onEdit: (projectId: number, field: "kommentar" | "projektLink", value: string) => void;
}) {
  const href = projectLinkUrl(project.projektLink ?? null);
  const who = project.projektnummer ?? project.id;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Kommentar und Link zu Projekt ${who}`}
          title="Kommentar & Link"
          className={ROW_BUTTON}
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kommentar &amp; Link</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label
              htmlFor={`kommentar-${project.id}`}
              className="text-xs font-bold uppercase text-muted-foreground"
            >
              Kommentar
            </label>
            <textarea
              id={`kommentar-${project.id}`}
              defaultValue={project.kommentar || ""}
              onBlur={(e) => onEdit(project.id, "kommentar", e.target.value)}
              className="min-h-[120px] w-full resize-y rounded-xl border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Kommentar eingeben …"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor={`projektlink-${project.id}`}
              className="text-xs font-bold uppercase text-muted-foreground"
            >
              Projektlink
            </label>
            <div className="flex gap-2">
              <Input
                id={`projektlink-${project.id}`}
                defaultValue={project.projektLink || ""}
                onBlur={(e) => onEdit(project.id, "projektLink", e.target.value)}
                className="flex-1"
                placeholder="https://..."
              />
              {href && (
                <Button variant="outline" size="icon" asChild>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Projektlink von ${who} in neuem Tab öffnen`}
                  >
                    <ExternalLink className="h-4 w-4 text-primary-strong" aria-hidden="true" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The two row actions, side by side.
 *
 * A flex row, not two inline buttons: the two 44px touch targets need a gap,
 * and `text-center` on the cell let them wrap instead — which tripled the row
 * height and, worse, made the later sibling win hit-testing so tapping
 * "Details anzeigen" opened the Kommentar dialog.
 */
export function RowActions({
  project,
  onShowDetails,
  onEdit,
}: {
  project: CommentableProject;
  onShowDetails: (projectId: number) => void;
  onEdit: (projectId: number, field: "kommentar" | "projektLink", value: string) => void;
}) {
  const who = project.projektnummer ?? project.id;
  return (
    <div className="cell-actions flex items-center justify-center gap-1">
      <button
        type="button"
        aria-label={`Details zu Projekt ${who} anzeigen`}
        title="Details anzeigen"
        onClick={() => onShowDetails(project.id)}
        className={ROW_BUTTON}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      <ProjectCommentDialog project={project} onEdit={onEdit} />
    </div>
  );
}
