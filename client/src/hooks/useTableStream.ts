/**
 * Turn a table body's arrival into a wave.
 *
 * Returns a ref to put on a `<tbody>`. When that tbody first scrolls into
 * view, `data-stream="on"` goes on it and the stylesheet does the rest — the
 * rows cascade down and each of the first rows fills in from the left.
 *
 * Why an attribute and not React state: the wave is a CSS concern, and a state
 * update here would re-render a table of 1.298 rows to change one attribute on
 * one element. This writes the attribute directly and never renders anything.
 *
 * The safety rule is the same as everywhere else in client/src/lib/motion.ts:
 * the attribute is only ever added when motion is allowed, and nothing is
 * hidden unless the attribute is there. Every row is in the DOM and countable
 * from the first paint, whatever the animation is doing.
 */
import { useEffect, useRef } from "react";
import { motionAllowed } from "@/lib/motion";

export function useTableStream<T extends HTMLElement = HTMLTableSectionElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!motionAllowed() || typeof IntersectionObserver === "undefined") return;

    /*
     * Replayed when the set changes, not only once.
     *
     * Filtering a table to four rows and back to 1.298 is a new arrival, and a
     * wave that only ever plays on mount would make the first result feel
     * alive and every one after it feel dead. The MutationObserver watches the
     * row count and re-arms; `requestAnimationFrame` lets the browser drop the
     * attribute and pick it up again as two frames, which is what restarts a
     * CSS animation.
     */
    let armed = false;
    const arm = () => {
      node.removeAttribute("data-stream");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => node.setAttribute("data-stream", "on"));
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (armed) return;
        armed = true;
        arm();
      },
            // Zero, not 0.01: a threshold is a fraction OF THE ELEMENT, and one per
      // cent of a 1.298-row table body is five hundred pixels. See motion.ts.
      { threshold: 0 },
    );
    io.observe(node);

    let rows = node.childElementCount;
    const mo = new MutationObserver(() => {
      const next = node.childElementCount;
      if (next === rows) return;
      rows = next;
      if (armed) arm();
    });
    mo.observe(node, { childList: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      node.removeAttribute("data-stream");
    };
  }, []);

  return ref;
}
