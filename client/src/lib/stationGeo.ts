import type { StationRecord } from "@/hooks/useStations";

export interface Geo {
  lat: number;
  lng: number;
}

export interface ResolvedStation {
  /** stable grouping key: exact station name, or "~bm:<BM>" for the regional fallback */
  key: string;
  /** display name for the popup header */
  name: string;
  lat: number;
  lng: number;
  /** true = placed on the real station; false = approximate (region centroid) */
  exact: boolean;
}

export interface StationGeoIndex {
  resolve(station: string | null | undefined, bm?: string | null): ResolvedStation | null;
  /** number of station rows that carry real coordinates */
  stationsWithCoords: number;
}

/** lowercase, de-accent, fold umlauts, drop punctuation — for tolerant matching */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[().,/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** apply domain aliases (FFM → Frankfurt (Main), strip Bf/Hp/VST prefixes and "- …" descriptions) */
function alias(s: string): string {
  return norm(s)
    .replace(/^ffm\b/, "frankfurt main")
    .replace(/\bffm\b/g, "frankfurt main")
    .replace(/\bhbf\b/g, "hauptbahnhof")
    .replace(/^bf /, "")
    .replace(/^hp /, "")
    .replace(/^vst /, "")
    .replace(/^uest /, "")
    .replace(/ - .*/, "")
    .trim();
}

interface Entry {
  name: string;
  toks: string[];
  lat: number;
  lng: number;
}

/**
 * Builds an index that resolves a (possibly messy) project station name to the
 * exact coordinates of one of the master stations. Resolution order:
 *   1. exact alias match  2. high-confidence token match (within this network's
 *   stations only, to avoid cross-region false hits)  3. region (BM) centroid
 *   fallback, flagged as approximate.
 */
export function buildStationGeo(rows: StationRecord[]): StationGeoIndex {
  const entries: Entry[] = [];
  const exact = new Map<string, Entry>();
  const bmAcc: Record<string, { lat: number; lng: number; n: number }> = {};

  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const a = alias(r.Station);
    const e: Entry = {
      name: r.Station,
      toks: a.split(" ").filter(Boolean),
      lat: r.lat,
      lng: r.lng,
    };
    entries.push(e);
    if (a && !exact.has(a)) exact.set(a, e);
    const acc = (bmAcc[r.BM] ??= { lat: 0, lng: 0, n: 0 });
    acc.lat += r.lat;
    acc.lng += r.lng;
    acc.n += 1;
  }

  const bmCentroid: Record<string, Geo> = {};
  for (const [bm, a] of Object.entries(bmAcc)) {
    bmCentroid[bm] = { lat: a.lat / a.n, lng: a.lng / a.n };
  }

  function resolve(station: string | null | undefined, bm?: string | null): ResolvedStation | null {
    if (station) {
      const a = alias(station);
      if (a) {
        const ex = exact.get(a);
        if (ex) return { key: ex.name, name: ex.name, lat: ex.lat, lng: ex.lng, exact: true };

        const q = new Set(a.split(" ").filter(Boolean));
        let best: Entry | null = null;
        let bestScore = -Infinity;
        for (const e of entries) {
          let inter = 0;
          for (const t of e.toks) if (q.has(t)) inter++;
          if (!inter) continue;
          const cov = inter / e.toks.length;
          const qcov = inter / q.size;
          // require one side to be fully contained → avoids loose partial matches
          if (cov === 1 || qcov === 1) {
            const score = inter * 2 - Math.abs(e.toks.length - q.size);
            if (score > bestScore) {
              bestScore = score;
              best = e;
            }
          }
        }
        if (best) return { key: best.name, name: best.name, lat: best.lat, lng: best.lng, exact: true };
      }
    }

    if (bm && bmCentroid[bm]) {
      const c = bmCentroid[bm];
      return { key: `~bm:${bm}`, name: `${bm} (Region – ungenau verortet)`, lat: c.lat, lng: c.lng, exact: false };
    }
    return null;
  }

  return { resolve, stationsWithCoords: entries.length };
}
