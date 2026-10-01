/**
 * Viewport virtualization for a real <table> — the DOM holds the rows on (and just around) the screen,
 * never every loaded row.
 *
 * Why spacer rows and not absolutely positioned rows: the table keeps its native semantics (rows, cells,
 * column widths from content, sticky header + sticky identity columns all keep working), and the scroll
 * height stays honest. Screen readers get `aria-rowcount` for the full set and `aria-rowindex` on each
 * rendered row, so "row 412 of 1,298" is announced even though only ~25 rows exist.
 *
 * Row height is MEASURED (rows differ: wrapped numbers, 2-line descriptions) with a deterministic estimate
 * until measured. Keyboard: ArrowUp/Down, PageUp/Down, Home/End move focus between rows in the same column,
 * scrolling the target in first; the focused row is always kept mounted so focus is never lost to the body.
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";

export interface VirtualRowsOptions {
  count: number;
  /** stable identity per index so measurements follow rows when the list changes (realtime patches, sorting) */
  getKey: (index: number) => string | number;
  estimate?: number;
  overscan?: number;
  /** height of the sticky header, so scrollToIndex does not hide the target under it */
  headerHeight?: number;
  /** header rows above the data (aria-rowindex is 1-based and counts them) */
  headerRows?: number;
}

export function useVirtualRows<T extends HTMLElement = HTMLDivElement>(scrollRef: RefObject<T | null>, o: VirtualRowsOptions) {
  const { count, getKey, estimate = 56, overscan = 8, headerHeight = 48, headerRows = 1 } = o;
  const [active, setActive] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);
  activeRef.current = active;

  const rangeExtractor = useCallback((r: Range) => {
    const base = defaultRangeExtractor(r);
    const a = activeRef.current;
    if (a === null || a >= r.count || base.includes(a)) return base;
    return [...base, a].sort((x, y) => x - y); // keep the focused row mounted while it is scrolled away
  }, []);

  const v = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimate,
    overscan,
    getItemKey: getKey,
    rangeExtractor,
    scrollPaddingStart: headerHeight,
  });

  const items = v.getVirtualItems();
  const total = v.getTotalSize();
  const paddingTop = items.length ? items[0]!.start : 0;
  const paddingBottom = items.length ? Math.max(0, total - items[items.length - 1]!.end) : 0;

  const focusCell = useCallback((index: number, column: number) => {
    v.scrollToIndex(index, { align: "auto" });
    let tries = 0;
    const attempt = () => {
      const row = scrollRef.current?.querySelector<HTMLElement>(`tr[data-index="${index}"]`);
      const cell = row?.children[column] as HTMLElement | undefined;
      const target = cell?.querySelector<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (target) { target.focus({ preventScroll: false }); return; }
      if (++tries < 12) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, [v, scrollRef]);

  /** put on the <tbody> */
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    // never steal arrows from an open editor, a select, or a text field
    if (t.closest("input, textarea, select, [role='combobox'], [role='listbox'], [contenteditable='true']")) return;
    const row = t.closest<HTMLElement>("tr[data-index]");
    const cell = t.closest<HTMLElement>("td");
    if (!row || !cell) return;
    const index = Number(row.dataset.index);
    const column = (cell as HTMLTableCellElement).cellIndex;
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 600) / estimate) - 1);
    const next = e.key === "ArrowDown" ? index + 1 : e.key === "ArrowUp" ? index - 1
      : e.key === "PageDown" ? index + page : e.key === "PageUp" ? index - page
      : e.key === "Home" && (e.ctrlKey || e.metaKey) ? 0 : e.key === "End" && (e.ctrlKey || e.metaKey) ? count - 1 : null;
    if (next === null) return;
    e.preventDefault();
    focusCell(Math.min(count - 1, Math.max(0, next)), column);
  }, [count, estimate, focusCell, scrollRef]);

  const onFocus = useCallback((e: React.FocusEvent<HTMLElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-index]");
    setActive(row ? Number(row.dataset.index) : null);
  }, []);
  const onBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(null);
  }, []);

  return useMemo(() => ({
    items, paddingTop, paddingBottom, total,
    measureElement: v.measureElement,
    scrollToIndex: v.scrollToIndex,
    /** spread on <tbody> */
    bodyProps: { onKeyDown, onFocus, onBlur },
    /** props for each rendered <tr> */
    rowProps: (index: number) => ({ "data-index": index, "aria-rowindex": index + headerRows + 1, ref: v.measureElement }),
    /** props for the <table> */
    tableProps: { "aria-rowcount": count + headerRows, "data-row-count": count },
    lastIndex: items.length ? items[items.length - 1]!.index : -1,
  }), [items, paddingTop, paddingBottom, total, v, onKeyDown, onFocus, onBlur, count, headerRows]);
}
