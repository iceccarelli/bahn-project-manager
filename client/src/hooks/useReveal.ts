/**
 * One line per page: its sections arrive one at a time as they are scrolled to.
 *
 * Put the returned ref on a container; every direct child of it becomes a
 * revealed section, staggered by position. Pass a `key` that changes whenever
 * the children are replaced — a view toggle, a filter — so the cascade plays
 * for the new arrangement instead of only for the first one.
 *
 * Decoration only. See client/src/lib/motion.ts for why nothing here can ever
 * leave content unrendered, unmeasurable or unreadable.
 */
import { useEffect, useRef } from "react";
import { revealChildren } from "@/lib/motion";

export function useReveal<T extends HTMLElement = HTMLDivElement>(key: unknown = null) {
  const ref = useRef<T>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trigger, not a value the effect reads
  useEffect(() => {
    // A frame's grace, so children rendered in the same commit are all present.
    const id = requestAnimationFrame(() => revealChildren(ref.current));
    return () => cancelAnimationFrame(id);
  }, [key]);
  return ref;
}
