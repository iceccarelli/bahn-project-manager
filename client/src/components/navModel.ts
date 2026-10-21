/**
 * The application's navigation, defined once. The desktop/tablet rail and the phone's bottom tab bar both render this,
 * so a destination cannot exist in one and be forgotten in the other.
 *
 *   rail (>= 768 px)   every item, icon + label (icon-only when the rail is collapsed)
 *   bottom bar (< 768) four primary destinations + the centre action + "Mehr" (everything else)
 */
export type NavId = "start" | "anmeldung" | "projekte" | "bvb-eea" | "psv-itk" | "aktivitaet" | "einstellungen";

export interface NavItem {
  id: NavId;
  label: string;
  /** shorter label for the bottom bar, where five items share the width */
  shortLabel: string;
  path: string;
  /** where it sits on a phone */
  phone: "tab" | "action" | "more";
}

/** Order = order in the rail. The phone arranges tabs by `PHONE_ORDER`. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "start", label: "Dashboard", shortLabel: "Start", path: "/", phone: "tab" },
  { id: "anmeldung", label: "Projektanmeldung", shortLabel: "Anmelden", path: "/anmeldung", phone: "action" },
  { id: "projekte", label: "Projekte", shortLabel: "Projekte", path: "/projects", phone: "tab" },
  { id: "bvb-eea", label: "BVB-EEA", shortLabel: "BVB-EEA", path: "/bvb-eea", phone: "more" },
  { id: "psv-itk", label: "PSV-ITK", shortLabel: "PSV-ITK", path: "/psv-itk", phone: "more" },
  { id: "aktivitaet", label: "Änderungshistorie", shortLabel: "Aktivität", path: "/audit", phone: "tab" },
  { id: "einstellungen", label: "Einstellungen", shortLabel: "Konto", path: "/einstellungen", phone: "more" },
] as const;

/** Left to right on a phone: Start, Projekte, [Anmelden], Aktivität, Mehr. */
export const PHONE_ORDER: readonly NavId[] = ["start", "projekte", "anmeldung", "aktivitaet"];

const byId = new Map(NAV_ITEMS.map(i => [i.id, i]));
export const navItem = (id: NavId): NavItem => {
  const i = byId.get(id);
  if (!i) throw new Error(`unknown nav item ${id}`);
  return i;
};

/** Pathname only (query and hash never decide), segment-aware: /projects matches /projects and /projects/x, not /projects-old. */
export function isActivePath(location: string, itemPath: string): boolean {
  const here = location.split(/[?#]/)[0] || "/";
  if (itemPath === "/") return here === "/";
  return here === itemPath || here.startsWith(`${itemPath}/`);
}

export const activeNavId = (location: string): NavId | null => NAV_ITEMS.find(i => isActivePath(location, i.path))?.id ?? null;

export const phoneBarItems = (): NavItem[] => PHONE_ORDER.map(navItem);
export const moreItems = (): NavItem[] => NAV_ITEMS.filter(i => i.phone === "more");
/** "Mehr" is the highlighted tab while the open page lives behind it. */
export const moreIsActive = (location: string): boolean => moreItems().some(i => isActivePath(location, i.path));
