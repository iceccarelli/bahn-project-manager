import { ClipboardCheck, FileCheck, History, LayoutDashboard, Network, Settings, Table2, type LucideIcon } from "lucide-react";
import type { NavId } from "./navModel";

/** One icon per destination, shared by the rail and the phone's bottom bar. */
export const NAV_ICONS: Record<NavId, LucideIcon> = {
  start: LayoutDashboard,
  anmeldung: ClipboardCheck,
  projekte: Table2,
  "bvb-eea": FileCheck,
  "psv-itk": Network,
  aktivitaet: History,
  einstellungen: Settings,
};
