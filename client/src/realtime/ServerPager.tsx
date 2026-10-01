import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * Cursor-page loader. The next page is fetched when the sentinel scrolls into
 * view; the button is the keyboard/no-IntersectionObserver path. The text says
 * exactly how much of the server result is on screen.
 */
export function ServerPager({
  loaded, total, hasNextPage, isFetching, onLoadMore, auto = true,
}: { loaded: number; total: number | undefined; hasNextPage: boolean; isFetching: boolean; onLoadMore(): void; /** load when the sentinel scrolls into view; off when the list drives paging from its own scroll position (virtualized table) */ auto?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!auto || !el || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting) && !isFetching) onLoadMore(); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [auto, hasNextPage, isFetching, onLoadMore, loaded]);
  return (
    <div ref={ref} className="flex flex-col items-center gap-2 py-4" data-testid="server-pager">
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {loaded.toLocaleString("de-DE")}{total !== undefined ? ` von ${total.toLocaleString("de-DE")}` : ""} Projekten geladen
      </p>
      {hasNextPage && (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isFetching}>
          {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Weitere laden
        </Button>
      )}
    </div>
  );
}
