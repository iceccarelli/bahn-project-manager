import * as React from "react";

/**
 * Below this width the sidebar becomes an off-canvas sheet instead of holding a
 * permanent 260px column.
 *
 * It used to be 768. At exactly 768 the sidebar still claimed its 260px, leaving
 * 508px for the content column — not enough for the header's search field plus
 * its four controls, so the right-hand cluster overflowed the viewport on every
 * single route. 1024 is also where Tailwind's `lg:` breakpoint sits, which is
 * what the layout's own padding rules already switch on.
 */
const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
