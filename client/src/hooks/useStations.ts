import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * One row of /stations.json (DB station master list, 910 entries).
 * Keys mirror the source file exactly (German labels, with spaces/dots).
 */
export interface StationRecord {
  Land: string;
  BM: string;
  "Bf. Nr.": number;
  Station: string;
  "Bf DS 100Abk.": string;
  "Kat. Vst": number;
  "Straße": string;
  PLZ: number;
  Ort: string;
  "Aufgabenträger": string;
}

/**
 * Static, hard-coded list of project phases (Projektstand).
 * Order is intentional and matches the business workflow.
 */
export const PROJEKTSTAND_OPTIONS = [
  "VEP",
  "EP",
  "AP",
  "Mieterumbau",
  "CSM-RA",
  "Projektkonfiguration",
  "EIGV",
] as const;

export type Projektstand = (typeof PROJEKTSTAND_OPTIONS)[number];

interface StationCascade {
  /** raw rows */
  rows: StationRecord[];
  /** sorted, de-duplicated list of BM regions (the first dropdown) */
  regions: string[];
  /** BM -> sorted unique station names (the second dropdown) */
  stationsByRegion: Record<string, string[]>;
  /** station name -> Bf. Nr. (auto-filled, read-only third field) */
  bfNrByStation: Record<string, number>;
  /** station name -> BM (lets us back-fill region if a station is picked first) */
  regionByStation: Record<string, string>;
}

const EMPTY: StationCascade = {
  rows: [],
  regions: [],
  stationsByRegion: {},
  bfNrByStation: {},
  regionByStation: {},
};

/**
 * Loads /stations.json (served from client/public) and derives the
 * BM -> Station -> Bf. Nr. cascade used by the "Neues Projekt" dialog.
 * The file is static, so it is cached effectively forever.
 */
export function useStations() {
  const { data: rows = [], isLoading } = useQuery<StationRecord[]>({
    queryKey: ["stations"],
    queryFn: async () => {
      const res = await fetch("/stations.json");
      if (!res.ok) throw new Error(`stations.json HTTP ${res.status}`);
      return res.json();
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const cascade = useMemo<StationCascade>(() => {
    if (!rows.length) return EMPTY;

    const regionSet = new Set<string>();
    const stationsByRegion: Record<string, Set<string>> = {};
    const bfNrByStation: Record<string, number> = {};
    const regionByStation: Record<string, string> = {};

    for (const r of rows) {
      const bm = r.BM;
      const station = r.Station;
      if (!bm || !station) continue;
      regionSet.add(bm);
      (stationsByRegion[bm] ??= new Set<string>()).add(station);
      bfNrByStation[station] = r["Bf. Nr."];
      regionByStation[station] = bm;
    }

    const collator = new Intl.Collator("de");
    return {
      rows,
      regions: Array.from(regionSet).sort(collator.compare),
      stationsByRegion: Object.fromEntries(
        Object.entries(stationsByRegion).map(([bm, set]) => [
          bm,
          Array.from(set).sort(collator.compare),
        ])
      ),
      bfNrByStation,
      regionByStation,
    };
  }, [rows]);

  return { ...cascade, isLoading };
}
