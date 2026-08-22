/**
 * The search box that sits above a table.
 *
 * Projekte had one with a suggestion list; the two Gewerk tabs had a bare
 * input. Both are this component now, and both are backed by the same index the
 * header palette uses, so a term that finds something in one place finds it in
 * all of them. A filter box deliberately does *not* offer pages or views: it
 * narrows the table underneath it, and a suggestion that navigated away from
 * the filter the reader is building would be a trap.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useSearchIndex } from "@/hooks/useSearchIndex";
import { suggestTerms } from "@shared/search";

export function FilterSearch({
  value,
  onChange,
  onSubmit,
  ariaLabel,
  placeholder = "Ort, Projektleitung, Prüfer …",
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Enter, or picking a suggestion. */
  onSubmit: (term: string) => void;
  ariaLabel: string;
  placeholder?: string;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLInputElement>(null);

  // Nothing builds the index until somebody engages with the search — see
  // useSearchIndex. Building it at mount cost every navigation a few hundred
  // milliseconds of main thread for a box most visits never touch.
  const index = useSearchIndex(open || value.trim().length > 1);
  const deferred = useDeferredValue(value);
  const suggestions = useMemo(
    () => (deferred.trim().length > 1 ? suggestTerms(index, deferred, 8) : []),
    [index, deferred],
  );

  // Same reason as CommandSearch: a stale index would submit the wrong term.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `deferred` is the re-run trigger
  useEffect(() => setActive(-1), [deferred]);

  const choose = (term: string) => {
    onChange(term);
    onSubmit(term);
    setOpen(false);
    boxRef.current?.blur();
  };

  const listboxId = `${id}-suggestions`;
  const showList = open && suggestions.length > 0;

  return (
    <div className="relative min-w-[16rem] flex-1">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={boxRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
        onKeyDown={(e) => {
          if (e.key === "Escape") return setOpen(false);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (suggestions.length === 0 ? -1 : (i + 1) % suggestions.length));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) =>
              suggestions.length === 0 ? -1 : (i - 1 + suggestions.length) % suggestions.length,
            );
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const picked = active >= 0 ? suggestions[active] : undefined;
            choose(picked ? picked.label : value);
          }
        }}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
      />
      {/*
        WAI-ARIA 1.2 combobox: focus stays in the input and aria-activedescendant
        names the active option, so the listbox must NOT be focusable and must
        not be a <select> — a native select cannot render two lines, an icon and
        a group heading per option, and cannot be typed into.
      */}
      {showList && (
        // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the combobox input by design
        // biome-ignore lint/a11y/useSemanticElements: a native <select> cannot render two-line options with icons and group headings
        <div
          id={listboxId}
          role="listbox"
          aria-label="Vorschläge"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-background shadow-lg"
        >
          {suggestions.map((s, i) => (
            <button
              type="button"
              key={`${s.kind}-${s.label}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s.label)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors ${
                i === active ? "bg-primary/10" : "hover:bg-muted/70"
              }`}
            >
              <span className="truncate">{s.label}</span>
              {s.sublabel && (
                <span className="shrink-0 text-2xs text-muted-foreground">{s.sublabel}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default FilterSearch;
