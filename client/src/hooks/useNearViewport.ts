/**
 * Mount the heavy thing when the reader is on their way to it.
 *
 * ---------------------------------------------------------------------------
 * The measurement that made this necessary
 * ---------------------------------------------------------------------------
 * The Netz-Explorer draws 425 station markers, each a DOM element: 3.444 nodes
 * on the Dashboard instead of 2.125. Nothing about that is visible while the
 * reader is at the top of the page using the search box — except in the cost
 * of every keystroke, because every input re-lays-out a document that is now
 * 60 % larger. Measured, "Langenselbold" typed character by character at
 * 1440x900, three runs each:
 *
 *   mit Karte im DOM     worst 68 / 80 / 69 ms   median 43 / 39 / 32 ms
 *   Karte entfernt       worst 34 / 41 / 37 ms   median 24 / 20 / 24 ms
 *
 * Twice the cost per keystroke, for a panel below the fold that nobody is
 * looking at while they type. On a loaded machine that difference took the
 * stress suite's per-keystroke budget from 102 ms to 126 ms and failed it.
 *
 * ---------------------------------------------------------------------------
 * Why "near", not "visible"
 * ---------------------------------------------------------------------------
 * rootMargin gives the map a screen's worth of warning, so it is built before
 * it comes into view rather than assembling itself under the reader's eyes.
 * Once mounted it stays mounted: a panel that unmounts on scroll-away would
 * rebuild its Leaflet instance every time somebody scrolled past, which is the
 * expensive half of this trade repeated forever.
 *
 * Nothing that carries a figure may be mounted this way — see client/src/lib/
 * motion.ts. A count that appears only after scrolling is a count that is true
 * only sometimes. The placeholder therefore says what it is and how many
 * projects it will draw, and the map's own card carries the geocoding figures
 * once it is there.
 */
import { useEffect, useRef, useState } from "react";

export function useNearViewport<T extends HTMLElement = HTMLDivElement>(
  rootMargin = "400px 0px",
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return;
    const node = ref.current;
    if (!node) return;

    // No IntersectionObserver (old browser, or a JSDOM test): mount at once.
    // Degrading to "never shown" would hide a panel the page is built around.
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [near, rootMargin]);

  return [ref, near];
}
