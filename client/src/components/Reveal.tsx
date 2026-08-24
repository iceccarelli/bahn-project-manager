/**
 * A section that arrives.
 *
 * Wraps children in one element that fades and rises into place the first time
 * it is scrolled to, then never again. `as` keeps the markup honest — a
 * revealed table row is still a <tr>, a revealed list item still an <li> —
 * because a wrapper <div> inside a <tbody> is invalid HTML and a wrapper
 * around a grid child breaks the grid.
 *
 * Everything about the safety of this lives in client/src/lib/motion.ts: the
 * element is always in the DOM, always in flow, and only ever hidden when
 * something exists that will show it again.
 */
import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import { observeReveal } from "@/lib/motion";

export function Reveal({
  children,
  as: Tag = "div",
  /** Position in a run of siblings — turns a list into a cascade. */
  index = 0,
  className = "",
  ...rest
}: {
  children: ReactNode;
  as?: ElementType;
  index?: number;
  className?: string;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => observeReveal(ref.current), []);
  return (
    <Tag
      ref={ref}
      className={`reveal ${className}`}
      /*
       * The stagger is capped at eight steps.
       *
       * Uncapped, the twentieth card on a Dashboard would wait 1.2s after the
       * first — by which time the reader has scrolled past it and is looking
       * at an empty box. A cascade is a flourish on the first few; after that
       * it is just latency with a nice name.
       */
      style={{ "--reveal-i": Math.min(index, 8) } as React.CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export default Reveal;
