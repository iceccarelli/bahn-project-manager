/**
 * How much room is left in the only place this app keeps changes.
 *
 * ---------------------------------------------------------------------------
 * Why a budget, and why it is 5 MB
 * ---------------------------------------------------------------------------
 * Every edit lands in localStorage — there is no server in the deployed build.
 * localStorage is capped per origin at 5 MB in Chrome, Firefox and Safari
 * alike, and that cap is *not* what navigator.storage.estimate() reports:
 * measured in this app, the estimate said 519 MB while the store it was
 * describing can hold 5. A budget built on the estimate would read 0.4 % full
 * at the moment the next write throws.
 *
 * Measured on the shipped data: the project store alone is 2.15 MB with no
 * edits made — 43 % of the cap before anyone has touched anything. The audit
 * trail is capped at 1,000 entries and checklist drafts are small, so the
 * store does not grow without bound; but "does not grow without bound" and
 * "has room" are different claims, and a reader who is about to lose a change
 * deserves to see the second one before it happens rather than after.
 *
 * What happens at the cap is the reason this is on screen: setItem throws
 * QuotaExceededError, the mutation rolls back, and the change is gone. It is
 * caught and named now (StorageFullError), but the honest fix is to stop
 * keeping a company's project data in a browser — see docs/GITLAB-MIGRATION.md
 * and the persistence section of the doctor's report.
 */

/** Per-origin localStorage cap in Chrome, Firefox and Safari. Not a guess. */
export const LOCAL_STORAGE_CAP_BYTES = 5 * 1024 * 1024;

/** Above this share of the cap the panel warns; above CRITICAL it alarms. */
export const BUDGET_TIGHT = 70;
export const BUDGET_CRITICAL = 90;

export type BudgetLevel = "ok" | "eng" | "kritisch";

export interface StorageBudget {
  usedBytes: number;
  capBytes: number;
  freeBytes: number;
  /** 0–100, rounded to one decimal. */
  share: number;
  level: BudgetLevel;
  /** Largest keys first — what is actually taking the room. */
  biggest: Array<{ key: string; bytes: number }>;
}

export function storageBudget(
  entries: Readonly<Record<string, number>>,
  capBytes: number = LOCAL_STORAGE_CAP_BYTES,
): StorageBudget {
  const pairs = Object.entries(entries)
    .map(([key, bytes]) => ({ key, bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0 }))
    .sort((a, b) => b.bytes - a.bytes);
  const usedBytes = pairs.reduce((sum, p) => sum + p.bytes, 0);
  const cap = capBytes > 0 ? capBytes : LOCAL_STORAGE_CAP_BYTES;
  const share = Math.round((usedBytes / cap) * 1000) / 10;
  return {
    usedBytes,
    capBytes: cap,
    freeBytes: Math.max(0, cap - usedBytes),
    share,
    level: share >= BUDGET_CRITICAL ? "kritisch" : share >= BUDGET_TIGHT ? "eng" : "ok",
    biggest: pairs.slice(0, 5),
  };
}

/** German, one decimal, never "0.00 MB" for something that exists. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 kB";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0).replace(".", ",")} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
