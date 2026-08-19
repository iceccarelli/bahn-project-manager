import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { TerminStatus } from "@shared/checklist";

/**
 * One row of /schedule.json — the Fachspezialistenprüfung slot calendar,
 * extracted from sheet `Zeit auswählen` by scripts/extract-schedule-xlsm.ts.
 */
export interface ScheduleSlot {
  /** "<ISO date>T<HH:MM>" — stable and sortable */
  id: string;
  datum: string;
  von: string;
  bis: string;
  status: TerminStatus | string;
  /** raw column E: "<Projektleitung> - <Station> - <Projektstand>" */
  info: string | null;
  projektleitung: string | null;
  station: string | null;
  projektstand: string | null;
  /** column F, e.g. "TBQ nicht verfügbar" */
  hinweis: string | null;
}

/** A slot plus everything the picker needs to render and reason about it. */
export interface ResolvedSlot extends ScheduleSlot {
  /** status after the pre-booking release rule and local bookings are applied */
  effectiveStatus: TerminStatus | string;
  /** true when this session booked it (held in localStorage, like every other mutation) */
  bookedLocally: boolean;
  selectable: boolean;
  /** true when a "Vorgebucht" hold was released because the slot is within 8 days */
  releasedFromHold: boolean;
  /** departments unavailable in this slot, parsed from `hinweis` */
  unavailable: string[];
}

const STORAGE_KEY_BOOKINGS = "bahn_termin_bookings_v1";

interface LocalBooking {
  slotId: string;
  checklistId: string;
  info: string;
  bookedAt: string;
}

export function readLocalBookings(): LocalBooking[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BOOKINGS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalBooking[]) : [];
  } catch {
    // corrupt or unavailable storage must never stop the calendar rendering
    return [];
  }
}

export function writeLocalBookings(bookings: LocalBooking[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_BOOKINGS, JSON.stringify(bookings));
  } catch {
    // private mode / quota — the booking simply does not persist
  }
}

/**
 * Reproduces the release rule from `DieseArbeitsmappe.Workbook_Open`:
 *
 *   If Cells(i,4) = "Gebucht" Then           ' leave alone
 *   ElseIf Cells(i,4) = "Frei" Then          ' leave alone
 *   ElseIf (Date + 8) < Datum Then           ' still held
 *   Else Cells(i,4) = "Frei"                 ' release the hold
 *
 * So a "Vorgebucht für IM/IT" hold survives only while the slot is more than
 * 8 days away; inside that window it is released to Frei.
 */
export function applyHoldRelease(
  status: string,
  datum: string,
  today: Date,
): { status: string; released: boolean } {
  if (status === "Gebucht" || status === "Frei") return { status, released: false };
  const slotDay = new Date(`${datum}T00:00:00Z`).getTime();
  const cutoff = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 8),
  ).getTime();
  if (cutoff < slotDay) return { status, released: false };
  return { status: "Frei", released: true };
}

/** `hinweis` names the specialists who cannot attend; surface them as a list. */
export function parseUnavailable(hinweis: string | null): string[] {
  if (!hinweis) return [];
  const m = /^(.*?)\s+nicht verfügbar/i.exec(hinweis);
  if (!m?.[1]) return [];
  return m[1]
    .split(/\s+und\s+|,/)
    .map((s) => s.replace(/^-|-$/g, "").trim())
    .filter(Boolean);
}

export interface ScheduleOptions {
  /** injectable for tests and for deterministic rendering; defaults to now */
  today?: Date;
  /** the workbook filters to [today, today + 180]; same default here */
  horizonDays?: number;
}

export function useSchedule(options: ScheduleOptions = {}) {
  const { horizonDays = 180 } = options;

  const { data: slots = [], isLoading } = useQuery<ScheduleSlot[]>({
    queryKey: ["schedule"],
    queryFn: async () => {
      const res = await fetch("/schedule.json");
      if (!res.ok) throw new Error(`schedule.json HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error("schedule.json is not an array");
      return json as ScheduleSlot[];
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  // Anchored to the day, not the millisecond, so the memo is stable across
  // re-renders and the calendar never shifts mid-session.
  const todayIso = (options.today ?? new Date()).toISOString().slice(0, 10);

  return useMemo(() => {
    const today = new Date(`${todayIso}T00:00:00Z`);
    const horizon = new Date(today.getTime() + horizonDays * 86400000)
      .toISOString()
      .slice(0, 10);
    const bookings = readLocalBookings();
    const bookedIds = new Map(bookings.map((b) => [b.slotId, b]));

    const resolved: ResolvedSlot[] = slots
      .filter((s) => s.datum >= todayIso && s.datum <= horizon)
      .map((s) => {
        const local = bookedIds.get(s.id);
        const { status, released } = applyHoldRelease(s.status, s.datum, today);
        const effectiveStatus = local ? "Gebucht" : status;
        return {
          ...s,
          info: local ? local.info : s.info,
          effectiveStatus,
          bookedLocally: Boolean(local),
          selectable: effectiveStatus === "Frei",
          releasedFromHold: released,
          unavailable: parseUnavailable(s.hinweis),
        };
      });

    const byDate = new Map<string, ResolvedSlot[]>();
    for (const s of resolved) {
      const bucket = byDate.get(s.datum);
      if (bucket) bucket.push(s);
      else byDate.set(s.datum, [s]);
    }

    return {
      slots: resolved,
      days: [...byDate.entries()].map(([datum, daySlots]) => ({ datum, slots: daySlots })),
      freeCount: resolved.filter((s) => s.selectable).length,
      isLoading,
      todayIso,
    };
  }, [slots, todayIso, horizonDays, isLoading]);
}

/** Book a slot locally. Returns false when it is no longer free. */
export function bookSlot(slotId: string, checklistId: string, info: string): boolean {
  const bookings = readLocalBookings();
  if (bookings.some((b) => b.slotId === slotId)) return false;
  bookings.push({ slotId, checklistId, info, bookedAt: new Date().toISOString() });
  writeLocalBookings(bookings);
  return true;
}

/** Release a slot this session booked. */
export function releaseSlot(slotId: string): void {
  writeLocalBookings(readLocalBookings().filter((b) => b.slotId !== slotId));
}
