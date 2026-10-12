import type { ChecklistTemplate, Technik } from "../types";
import { DBOS_TEMPLATE } from "./dbos";
import { DSA_PLUS_TEMPLATE } from "./dsa-plus";
import { VIDEO_TEMPLATE } from "./video";
import { ZIM_TEMPLATE } from "./zim";

/**
 * Technik → template. ELA, WLAN and SAA are Techniken of the ITK platform with
 * no Abnahme checklist yet: they stay absent here and the selector shows them
 * as unavailable. Adding one is a new template module plus one line below.
 */
export const ABNAHME_TEMPLATES: Readonly<Partial<Record<Technik, ChecklistTemplate>>> = {
  ZIM: ZIM_TEMPLATE,
  Video: VIDEO_TEMPLATE,
  "DSA+": DSA_PLUS_TEMPLATE,
  dBOS: DBOS_TEMPLATE,
};

export function templateFor(technik: Technik): ChecklistTemplate | null {
  return ABNAHME_TEMPLATES[technik] ?? null;
}

/** Whether a Technik has a checklist to work through. */
export function hasTemplate(technik: Technik): boolean {
  return templateFor(technik) !== null;
}
