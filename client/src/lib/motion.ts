/**
 * Cinematic motion that automation and accessibility both see through.
 *
 * ---------------------------------------------------------------------------
 * The rule that makes this safe
 * ---------------------------------------------------------------------------
 * Nothing here ever removes an element, hides it with `display`, or delays
 * rendering it. Every element is in the DOM, in flow, and measurable from the
 * first paint. A reveal changes `opacity` and `transform` only — two
 * properties that affect no layout and no text content.
 *
 * That is not a stylistic preference, it is what keeps the whole thing
 * honest. A page that mounts its content when it scrolls into view is a page
 * where "1.298 Projekte gefunden" is true only sometimes, where the UI audit
 * measures blank cards, and where a row count in a test depends on how far the
 * harness happened to scroll. Every one of those is a real defect wearing an
 * animation as a disguise.
 *
 * ---------------------------------------------------------------------------
 * The switch
 * ---------------------------------------------------------------------------
 * `<html data-motion="on">` is set at boot, and ONLY when the reader has not
 * asked for reduced motion. Every hiding rule in the stylesheet is scoped
 * under that attribute, so:
 *
 *   — reduced motion  → the attribute never appears → nothing is ever hidden,
 *                       no animation runs, the page is simply there;
 *   — no JavaScript   → same, for the same reason;
 *   — an audit        → emulates reduced motion and measures the final state,
 *                       which is the state it is supposed to be measuring.
 *
 * There is no test-only flag. The path automation takes is the path a person
 * who asked not to be moved takes, which means it is a path that has to work.
 */

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True when this reader has not asked us to stop moving things. */
export function motionAllowed(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return !window.matchMedia(MOTION_QUERY).matches;
}

/**
 * Put the switch on <html> and keep it in step with the OS setting.
 *
 * Called once from main.tsx, before React renders, so the first paint already
 * knows which world it is in and nothing flashes from hidden to shown.
 */
export function installMotionSwitch(): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(MOTION_QUERY);
  const apply = () => {
    const root = document.documentElement;
    if (mq.matches) root.removeAttribute("data-motion");
    else root.setAttribute("data-motion", "on");
  };
  apply();
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}

/**
 * One observer for the whole page, not one per element.
 *
 * A Dashboard has dozens of revealable sections and a table has hundreds of
 * rows; an IntersectionObserver each would be hundreds of observers competing
 * for the same scroll. This is a single instance every element registers with,
 * and each element is unobserved the moment it has been seen — a reveal
 * happens once, and after that the element is just an element.
 */
let observer: IntersectionObserver | null = null;

function sharedObserver(): IntersectionObserver | null {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) return null;
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.setAttribute("data-revealed", "true");
        observer?.unobserve(el);
      }
    },
    {
      /* A little before the edge, so a section is already arriving rather than
         starting to arrive once it is fully on screen. */
      rootMargin: "0px 0px -8% 0px",
      /*
       * Zero, meaning "any pixel of it is on screen".
       *
       * 0.01 sounds like the same thing and is not: it is one per cent OF THE
       * ELEMENT, and the Projekte table body is 1.298 rows tall. One per cent
       * of fifty thousand pixels is five hundred, so a table could be filling
       * the screen and still not have met its own threshold — which is exactly
       * how the stream came to never start.
       */
      threshold: 0,
    },
  );
  return observer;
}

/**
 * Register an element to reveal when it is scrolled to.
 *
 * Marks it hidden FIRST and only if motion is allowed and an observer exists —
 * so on any path where the reveal cannot happen, the element is never hidden
 * in the first place. There is no state in which content is invisible with
 * nothing left to show it.
 */
export function observeReveal(el: HTMLElement | null): () => void {
  if (!el) return () => {};
  const io = sharedObserver();
  if (!io || !motionAllowed()) {
    el.setAttribute("data-revealed", "true");
    return () => {};
  }
  el.setAttribute("data-revealed", "false");
  io.observe(el);
  return () => io.unobserve(el);
}

/**
 * Reveal every direct child of one container, one after another.
 *
 * The alternative was wrapping fifty-eight cards on the Dashboard by hand,
 * which is fifty-eight chances to wrap the wrong element — a `<div>` inside a
 * `<tbody>`, a wrapper around a grid child that breaks the grid. This adds the
 * class and the stagger index to children that already exist, so the markup
 * does not change at all and nothing can be nested wrongly.
 *
 * Re-run it by changing `key`: switching the Projekte view replaces the
 * children, and a cascade that only ever played on mount would make the first
 * arrangement feel alive and every one after it feel dead.
 */
export function revealChildren(container: HTMLElement | null): () => void {
  if (!container) return () => {};
  const stop: Array<() => void> = [];
  let index = 0;
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    if (!(el instanceof HTMLElement)) continue;
    el.classList.add("reveal");
    el.style.setProperty("--reveal-i", String(Math.min(index, 8)));
    stop.push(observeReveal(el));
    index++;
  }
  return () => {
    for (const s of stop) s();
  };
}
