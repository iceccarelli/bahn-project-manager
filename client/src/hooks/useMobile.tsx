import * as React from "react";

/**
 * Below this width (phones) there is no side rail: navigation is the bottom tab bar (BottomTabBar). From here up the
 * side rail is always mounted — icons only below 1280 px, icon + label above — so tablets get a rail, not a drawer.
 *
 * History: this was 1024 when the sidebar always claimed 260px (at 768 that left 508px and the header overflowed). The
 * rail now starts collapsed to 3rem below 1280, so 768 leaves ~720px for the content column. Tailwind's `md:` is the
 * same 768, which the bar's `md:hidden` relies on — keep them in step. check-responsive.mjs fails if they drift.
 */
const MOBILE_BREAKPOINT = 768;

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
