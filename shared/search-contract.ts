/** Wire contract of the server-side global search (`search.query`): typed, authorization-scoped candidates. */
import type { HitKind } from "./search";

export interface SearchWireEntry {
  kind: HitKind;
  label: string;
  sublabel?: string;
  /** The exact target (URL state is canonical and shareable). */
  href: string;
  weight: number;
  terms?: string[];
  projectId?: number;
}

export interface SearchWireResult { q: string; entries: SearchWireEntry[] }
