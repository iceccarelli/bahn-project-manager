/**
 * The site-wide search.
 *
 * The header box used to be an <Input> with a list of bare strings under it.
 * Every suggestion looked the same whatever it was, choosing one always did the
 * same thing — dump the text into the Projekte filter — and the list itself was
 * unreachable by keyboard in any structured way: no combobox role, no
 * aria-activedescendant, no announcement that options had appeared. A screen
 * reader user typing here was told nothing at all.
 *
 * This is a proper combobox over shared/search-index.ts: grouped, typed,
 * keyboard-first, and every row goes where its kind says it should. It is also
 * reachable from anywhere with Ctrl/⌘-K, which is the shortcut every reader who
 * has used a modern tool already tries.
 *
 * Rendering rules that matter here:
 * — the listbox is measured, not guessed: it never grows past the viewport,
 *   because a 12-row list opening near the bottom of a phone used to run off
 *   the screen with no way to scroll it;
 * — the active row is scrolled into view on keyboard movement, so arrowing past
 *   the fold does not leave the reader looking at a stale row;
 * — hovering does not steal the keyboard cursor mid-typing.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Clock3,
  FileText,
  Layers,
  MapPin,
  Search as SearchIcon,
  SlidersHorizontal,
  User,
  Wand2,
  X,
} from "lucide-react";
import { useSearchIndex } from "@/hooks/useSearchIndex";
import { groupHits, search, KIND_LABEL, type HitKind, type SearchHit } from "@shared/search";

const KIND_ICON: Record<HitKind, typeof SearchIcon> = {
  seite: Layers,
  gewerk: SlidersHorizontal,
  station: MapPin,
  projekt: FileText,
  person: User,
  region: MapPin,
  status: SlidersHorizontal,
};

const RECENT_KEY = "bpm-recent-searches";
const RECENT_MAX = 6;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return readRecent();
  const next = [trimmed, ...readRecent().filter((r) => r !== trimmed)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A private window refuses the write. The search still works; only the
    // convenience is lost, and losing it silently is the right trade.
  }
  return next;
}

export function CommandSearch({ id = "app-search" }: { id?: string }) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Built once per data load. Rebuilding per keystroke was the old design's
  // real cost: 1,298 projects walked on every character typed.
  // Nothing builds the index until somebody engages with the search — see
  // useSearchIndex. Building it at mount cost every navigation a few hundred
  // milliseconds of main thread for a box most visits never touch.
  const index = useSearchIndex(open || query.trim().length > 0);

  // Deferred so a fast typist never waits on a scoring pass to see their own
  // character land. The scoring itself is synchronous and sub-millisecond.
  const deferred = useDeferredValue(query);
  const result = useMemo(
    () => (deferred.trim().length > 0 ? search(index, deferred, { limit: 14 }) : null),
    [index, deferred],
  );

  const hits: SearchHit[] = result?.hits ?? [];
  const groups = useMemo(() => groupHits(hits), [hits]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  // The highlight returns to the top whenever the query changes — otherwise
  // arrowing down, editing the term and pressing Enter opens whatever row
  // happens to sit at the old index in a completely different result set.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `deferred` is the re-run trigger
  useEffect(() => setActive(0), [deferred]);

  const go = useCallback(
    (hit: SearchHit) => {
      setRecent(pushRecent(query));
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
      setLocation(hit.href);
    },
    [query, setLocation],
  );

  /** Enter with nothing highlighted still has to do something sensible. */
  const runRaw = useCallback(
    (term: string) => {
      const trimmed = term.trim();
      if (!trimmed) return;
      setRecent(pushRecent(trimmed));
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
      setLocation(`/projects?q=${encodeURIComponent(trimmed)}`);
    },
    [setLocation],
  );

  // Ctrl/⌘-K from anywhere. Registered once, removed on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the highlighted row visible when arrowing past the fold.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[active];
      if (hit) go(hit);
      else runRaw(query);
    }
  };

  const showPanel = open && (query.trim().length > 0 || recent.length > 0);
  const listboxId = `${id}-listbox`;

  /*
   * While this list is open, the map stops pulsing.
   *
   * The Dashboard draws 425 station markers and about half of them animate,
   * because a pulse means an open Prüfung. That animation runs whether or not
   * anybody is looking at it, and it competes for the same frames as typing:
   * measured on the Dashboard, "Langenselbold" character by character cost a
   * median of 24,6 ms per keystroke with the pulse running and 18,6 ms with it
   * stopped — a quarter of the cost of every keystroke spent animating a panel
   * the reader has just covered with a result list.
   *
   * The attribute goes on <html>, the rule that reads it is in index.css next
   * to the pulse itself, and it is removed the moment the list closes. Nothing
   * is hidden and no information is withheld — the markers keep their colour,
   * their count and their legend entry. Only the animation pauses.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (showPanel) root.setAttribute("data-searching", "on");
    else root.removeAttribute("data-searching");
    return () => root.removeAttribute("data-searching");
  }, [showPanel]);

  return (
    <div className="relative w-full">
      <div className="group relative">
        <SearchIcon
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary-strong"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && flat[active] ? `${id}-opt-${active}` : undefined}
          /*
            Deliberately not "… Stationen, Prüfer …".
            
            This control sits in the header of every route, so its accessible
            name is matched against every by-name lookup in the app. A name
            containing "Station", "Projektnummer" or "Projektleitung" makes the
            global search the first match for a reader — or a harness — looking
            for the *form field* of that name, and the palette then opens over
            the page they were trying to fill in. It happened: the wizard's
            station field resolved to this box and its result list covered the
            step buttons underneath.
          */
          aria-label="Website durchsuchen — Projekte, Orte, Personen und Seiten"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // A timeout, not onMouseDown on the rows: blur fires before click,
          // and a keyboard user selecting with Enter never fires mousedown at
          // all — which is how the old list became unusable without a mouse.
          onBlur={() => window.setTimeout(() => setOpen(false), 160)}
          onKeyDown={onKeyDown}
          placeholder="Suchen … (Strg + K)"
          className="h-9 w-full rounded-lg border border-border bg-muted/50 pl-11 pr-9 text-sm transition-all focus:border-primary focus:bg-background focus:outline-none"
        />
        {query && (
          <button
            type="button"
            aria-label="Suche zurücksetzen"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/*
        WAI-ARIA 1.2 combobox: focus stays in the input and aria-activedescendant
        names the active option, so the listbox must NOT be focusable and must
        not be a <select> — a native select cannot render two lines, an icon and
        a group heading per option, and cannot be typed into.
      */}
      {showPanel && (
        // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the combobox input by design
        // biome-ignore lint/a11y/useSemanticElements: a native <select> cannot render two-line options with icons and group headings
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Suchergebnisse"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-background shadow-xl"
        >
          {query.trim().length === 0 ? (
            <>
              <p className="px-4 pb-1 pt-3 text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                Zuletzt gesucht
              </p>
              {recent.map((term) => (
                <button
                  type="button"
                  key={term}
                  onClick={() => {
                    setQuery(term);
                    inputRef.current?.focus();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
                >
                  <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{term}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              {result?.correction && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery(result.correction as string);
                    inputRef.current?.focus();
                  }}
                  className="flex w-full items-center gap-2 border-b border-border bg-amber-50 px-4 py-2.5 text-left text-xs text-amber-900 transition-colors hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70"
                >
                  <Wand2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Meinten Sie <strong className="font-semibold">{result.correction}</strong>?
                  </span>
                </button>
              )}

              {flat.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nichts gefunden für „{query.trim()}".
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.kind}>
                    <p className="px-4 pb-1 pt-3 text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                      {KIND_LABEL[group.kind]}
                    </p>
                    {group.hits.map((hit) => {
                      const i = flat.indexOf(hit);
                      const Icon = KIND_ICON[hit.kind];
                      return (
                        <button
                          type="button"
                          key={`${hit.kind}-${hit.label}-${hit.projectId ?? ""}-${i}`}
                          id={`${id}-opt-${i}`}
                          role="option"
                          aria-selected={i === active}
                          data-index={i}
                          data-search-kind={hit.kind}
                          // mousemove, not mouseenter: a cursor that happens to be resting
                          // where the list opens fires mouseenter without the
                          // user moving it, and silently steals the keyboard
                          // highlight — so Enter opened the row under the mouse
                          // instead of the row the reader was looking at.
                          onMouseMove={() => setActive(i)}
                          onClick={() => go(hit)}
                          className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                            i === active ? "bg-primary/10" : "hover:bg-muted/70"
                          }`}
                        >
                          <Icon
                            className={`h-4 w-4 shrink-0 ${i === active ? "text-primary-strong" : "text-muted-foreground"}`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{hit.label}</span>
                            {hit.sublabel && (
                              // The highlight tints the row red at 10%, and
                              // muted-foreground on that tint measures 4.3:1 —
                              // under the floor. The secondary line darkens with
                              // the highlight instead of staying put.
                              <span
                                className={`block truncate text-2xs ${
                                  i === active ? "text-foreground/75" : "text-muted-foreground"
                                }`}
                              >
                                {hit.sublabel}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}

              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-2xs text-muted-foreground">
                <span>
                  {flat.length} {flat.length === 1 ? "Treffer" : "Treffer"}
                  {result ? ` · ${result.tookMs} ms` : ""}
                </span>
                <span className="hidden sm:inline">↑↓ wählen · ⏎ öffnen · Esc schließen</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default CommandSearch;
