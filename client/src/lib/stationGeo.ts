import type { StationRecord } from "@/hooks/useStations";

export interface Geo {
  lat: number;
  lng: number;
}

/**
 * How a project's free-text station name was matched against the station master.
 * Replaces the previous `exact: boolean`, which reported token matches as exact
 * and therefore drew ~22% of markers as precise when they were not.
 */
export type MatchPrecision =
  /** the normalised names are identical */
  | "exact"
  /** identical word sets in a different order ("Hbf Mainz" vs "Mainz Hbf") */
  | "tokens"
  /** one name's words fully contain the other's ("Fulda Hbf" vs "Fulda") */
  | "fuzzy"
  /** no station matched — placed on the centroid of the project's own BM */
  | "region";

export interface ResolvedStation {
  /** stable grouping key: "<Bf. Nr.>" for a real station, "~bm:<BM>" for the regional fallback */
  key: string;
  /** display name for the popup header */
  name: string;
  lat: number;
  lng: number;
  precision: MatchPrecision;
  /** true only for precision === "exact" — the marker sits on the real station */
  isPrecise: boolean;
  /** Bf. Nr. of the matched station, null for the regional fallback */
  bfNr: number | null;
  /** true when more than one station scored equally and the lowest Bf-Nr was taken */
  ambiguous: boolean;
  /** the station's own BM — differs from the project's BM only when the project's is unknown */
  bm: string | null;
}

export interface ResolveStats {
  exact: number;
  tokens: number;
  fuzzy: number;
  region: number;
  /** neither a station nor a usable BM — these projects cannot be placed at all */
  unresolved: number;
}

export interface StationGeoIndex {
  resolve(station: string | null | undefined, bm?: string | null): ResolvedStation | null;
  /** number of station rows that carry real coordinates */
  stationsWithCoords: number;
  /** number of station rows with no coordinates — excluded from matching, never approximated */
  stationsWithoutCoords: number;
}

/** lowercase, de-accent, fold umlauts, drop punctuation — for tolerant matching */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[().,/\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Domain aliases. Every rule here is backed by values actually present in
 * client/public/data.json — see data/normalize-report.json →
 * stationNamesNotInMaster. Deliberately conservative: an alias that could
 * silently retarget a marker to a different town is not worth the coverage.
 */
function alias(s: string): string {
  return norm(s)
    .replace(/^ffm\b/, "frankfurt main")
    .replace(/\bffm\b/g, "frankfurt main")
    // "OF Ledermuseum", "OF Marktplatz" — only as a leading token
    .replace(/^of /, "offenbach ")
    .replace(/\bhbf\b/g, "hauptbahnhof")
    .replace(/^bf /, "")
    .replace(/^hp /, "")
    .replace(/^vst /, "")
    .replace(/^uest /, "")
    // strip a trailing free-text description: "Mainz Hbf - Asiagourmet"
    .replace(/ - .*/, "")
    .trim();
}

interface Entry {
  bfNr: number;
  name: string;
  bm: string;
  /** Bahnhofskategorie 1..7 — 1 is the largest. 99 stands in for "unknown". */
  kategorie: number;
  aliased: string;
  tokenKey: string;
  toks: string[];
  lat: number;
  lng: number;
}

function tokenKeyOf(aliased: string): string {
  return [...new Set(aliased.split(" ").filter(Boolean))].sort().join(" ");
}

/**
 * Deterministic winner among equally-scoring candidates.
 *
 * Primary key is Bahnhofskategorie: a bare city name ("Koblenz", "Worms",
 * "Mainz") means the city's main station, not whichever minor halt happens to
 * carry the lowest number. Category 1-2 are Hauptbahnhof-class, 6-7 are small
 * halts. Bf. Nr. only breaks a remaining tie, so the result is stable.
 */
function pickBest(candidates: Entry[]): Entry {
  return candidates.reduce((best, e) => {
    if (e.kategorie !== best.kategorie) return e.kategorie < best.kategorie ? e : best;
    return e.bfNr < best.bfNr ? e : best;
  });
}

/**
 * Builds an index that resolves a (possibly messy) project station name to the
 * coordinates of a master station.
 *
 * Resolution order — each tier is tried inside the project's own BM first, and
 * only then across all regions:
 *   1. exact alias equality
 *   2. identical token set (word order differences)
 *   3. token containment (one name's words fully contain the other's)
 *   4. BM centroid, reported as approximate
 *
 * Scoping every tier by BM is what stops "Sulzbach" / BM Saarbrücken from
 * landing on "Sulzbach (Taunus)" in BM Frankfurt, ~150 km away.
 */
export function buildStationGeo(rows: StationRecord[]): StationGeoIndex {
  const entries: Entry[] = [];
  const bmAcc: Record<string, { lat: number; lng: number; n: number }> = {};
  let withoutCoords = 0;

  for (const r of rows) {
    if (r.lat == null || r.lng == null) {
      withoutCoords++;
      continue;
    }
    const aliased = alias(r.Station);
    if (!aliased) continue;
    entries.push({
      bfNr: r["Bf. Nr."],
      name: r.Station,
      bm: r.BM,
      kategorie: r.Kategorie ?? 99,
      aliased,
      tokenKey: tokenKeyOf(aliased),
      toks: [...new Set(aliased.split(" ").filter(Boolean))],
      lat: r.lat,
      lng: r.lng,
    });
    // Retired stations still resolve, but must not drag a region's centroid.
    if (!r.retired) {
      let acc = bmAcc[r.BM];
      if (!acc) {
        acc = { lat: 0, lng: 0, n: 0 };
        bmAcc[r.BM] = acc;
      }
      acc.lat += r.lat;
      acc.lng += r.lng;
      acc.n += 1;
    }
  }

  // Stable order so every tie-break and every scan is deterministic.
  entries.sort((a, b) => a.bfNr - b.bfNr);

  const byAlias = new Map<string, Entry[]>();
  const byTokenKey = new Map<string, Entry[]>();
  const byBm = new Map<string, Entry[]>();
  const pushInto = <K>(m: Map<K, Entry[]>, k: K, e: Entry) => {
    const bucket = m.get(k);
    if (bucket) bucket.push(e);
    else m.set(k, [e]);
  };
  for (const e of entries) {
    pushInto(byAlias, e.aliased, e);
    pushInto(byTokenKey, e.tokenKey, e);
    pushInto(byBm, e.bm, e);
  }

  const bmCentroid: Record<string, Geo> = {};
  for (const [bm, a] of Object.entries(bmAcc)) {
    bmCentroid[bm] = { lat: a.lat / a.n, lng: a.lng / a.n };
  }

  function hit(e: Entry, precision: MatchPrecision, ambiguous: boolean): ResolvedStation {
    return {
      key: String(e.bfNr),
      name: e.name,
      lat: e.lat,
      lng: e.lng,
      precision,
      isPrecise: precision === "exact",
      bfNr: e.bfNr,
      ambiguous,
      bm: e.bm,
    };
  }

  /** token containment, restricted to `pool` */
  function fuzzy(pool: Entry[], q: Set<string>): Entry[] {
    let best: Entry[] = [];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const e of pool) {
      let inter = 0;
      for (const t of e.toks) if (q.has(t)) inter++;
      if (!inter) continue;
      // require one side to be fully contained → avoids loose partial matches
      if (inter !== e.toks.length && inter !== q.size) continue;
      const score = inter * 2 - Math.abs(e.toks.length - q.size);
      if (score > bestScore) {
        bestScore = score;
        best = [e];
      } else if (score === bestScore) {
        best.push(e);
      }
    }
    return best;
  }

  function resolve(
    station: string | null | undefined,
    bm?: string | null,
  ): ResolvedStation | null {
    const scoped = bm ? (byBm.get(bm) ?? null) : null;

    if (station) {
      const a = alias(station);
      if (a) {
        const tk = tokenKeyOf(a);

        for (const pool of [scoped, null] as (Entry[] | null)[]) {
          const inPool = (list: Entry[] | undefined) =>
            !list ? [] : pool ? list.filter((e) => e.bm === bm) : list;

          const exact = inPool(byAlias.get(a));
          if (exact.length) return hit(pickBest(exact), "exact", exact.length > 1);

          const tokens = inPool(byTokenKey.get(tk));
          if (tokens.length) return hit(pickBest(tokens), "tokens", tokens.length > 1);

          const q = new Set(a.split(" ").filter(Boolean));
          const near = fuzzy(pool ?? entries, q);
          if (near.length) return hit(pickBest(near), "fuzzy", near.length > 1);

          // scoped pass found nothing → fall through to the unscoped pass
          if (!pool) break;
        }
      }
    }

    if (bm && bmCentroid[bm]) {
      const c = bmCentroid[bm];
      return {
        key: `~bm:${bm}`,
        name: `${bm} (Region – ungenau verortet)`,
        lat: c.lat,
        lng: c.lng,
        precision: "region",
        isPrecise: false,
        bfNr: null,
        ambiguous: false,
        bm,
      };
    }
    return null;
  }

  return {
    resolve,
    stationsWithCoords: entries.length,
    stationsWithoutCoords: withoutCoords,
  };
}

/** Convenience: resolve a whole project list and report the precision mix. */
export function resolveAll(
  index: StationGeoIndex,
  projects: Array<{ station: string | null; bahnhofsmanagement: string | null }>,
): { resolved: Array<ResolvedStation | null>; stats: ResolveStats } {
  const stats: ResolveStats = { exact: 0, tokens: 0, fuzzy: 0, region: 0, unresolved: 0 };
  const resolved = projects.map((p) => {
    const r = index.resolve(p.station, p.bahnhofsmanagement);
    if (!r) stats.unresolved++;
    else stats[r.precision]++;
    return r;
  });
  return { resolved, stats };
}
