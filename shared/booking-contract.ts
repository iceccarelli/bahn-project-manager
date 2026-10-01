/** Booking (Fachspezialistenprüfung calendar slot) contract. */
import { z } from "zod";
import { TERMIN_STATUS } from "./checklist";

export const SLOT_STATUS = TERMIN_STATUS;
export type SlotStatus = (typeof SLOT_STATUS)[number];

const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const text = (n: number) => z.string().trim().max(n).nullable().optional();

export interface SlotDTO {
  id: number;
  slotKey: string;
  version: number;
  datum: string;            // YYYY-MM-DD
  von: string;
  bis: string;
  status: SlotStatus;
  /** present only for principals who may see the booking's workspace (or for free slots) */
  station: string | null;
  projektleitung: string | null;
  projektstand: string | null;
  info: string | null;
  hinweis: string | null;
  projectId: number | null;
  /** true when details were withheld from this caller */
  redacted: boolean;
}

export const ListSlotsInputSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(SLOT_STATUS).optional(),
});

/** Take a slot: Frei → Gebucht / Vorgebucht (a hold). */
export const BookSlotInputSchema = z.object({
  id: z.number().int().positive(),
  expectedVersion: z.number().int().min(1),
  status: z.enum(["Gebucht", "Vorgebucht für IM", "Vorgebucht für IT"]).default("Gebucht"),
  station: text(256), projektleitung: text(256), projektstand: text(128), info: text(512), hinweis: text(512),
  projectId: z.number().int().positive().nullable().optional(),
  idempotencyKey,
});
export type BookSlotInput = z.infer<typeof BookSlotInputSchema>;

/** Release: any state → Frei, details cleared. */
export const ReleaseSlotInputSchema = z.object({ id: z.number().int().positive(), expectedVersion: z.number().int().min(1), idempotencyKey });
export type ReleaseSlotInput = z.infer<typeof ReleaseSlotInputSchema>;
