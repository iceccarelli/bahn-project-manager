/**
 * The one door to localStorage, so a full disk cannot look like a lost edit.
 *
 * Every write in this app used to be a bare `localStorage.setItem(...)`. At the
 * 5 MB cap that call throws QuotaExceededError, the mutation rolls back, and
 * the reader sees their change revert with no explanation — indistinguishable
 * from the app dropping it. Same call, named error, real sentence.
 *
 * Reads stay direct where they already are: a read that fails returns nothing
 * and the caller falls back to /data.json, which is a path that already works.
 */

/** Thrown when the browser refuses a write because the store is full. */
export class StorageFullError extends Error {
  readonly key: string;
  readonly bytes: number;
  constructor(key: string, bytes: number) {
    super(
      "Lokaler Speicher ist voll — die Änderung wurde NICHT gespeichert. " +
        "Exportieren Sie die Daten (CSV) und leeren Sie den Browserspeicher, " +
        "oder verbinden Sie die Anwendung mit der Datenbank.",
    );
    this.name = "StorageFullError";
    this.key = key;
    this.bytes = bytes;
  }
}

const isQuotaError = (err: unknown): boolean => {
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    // 22 is the historical code, 1014 is Firefox's NS_ERROR_DOM_QUOTA_REACHED.
    return err.code === 22 || err.code === 1014 || /quota/i.test(err.name);
  }
  return err instanceof Error && /quota/i.test(err.message);
};

/**
 * Write, or say precisely why not.
 *
 * Throws rather than returning false: the callers are mutation functions whose
 * rollback and toast are already wired to a thrown error, and a boolean nobody
 * checks is how a silent failure gets built a second time.
 */
export function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (isQuotaError(err)) throw new StorageFullError(key, value.length);
    throw err;
  }
}

/** Byte size per key, for the budget panel. UTF-8, the unit the cap is in. */
export function storageEntries(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (const key of Object.keys(localStorage)) {
      const value = localStorage.getItem(key) ?? "";
      out[key] =
        typeof Blob === "function" ? new Blob([value]).size : new TextEncoder().encode(value).length;
    }
  } catch {
    // Private mode with storage disabled: no entries is the honest answer, and
    // the panel says "nicht messbar" rather than "0 von 5 MB".
    return {};
  }
  return out;
}

/**
 * Best-effort cache write, for the loader only.
 *
 * The loader already holds the data it was about to cache. Letting a full
 * store throw there would turn "no room to cache" into "no data at all": the
 * throw would unwind past the fetch, hit the fallback path, fail to cache
 * again, and return an empty array — a blank app because the browser was
 * short of 200 kB. Caching is an optimisation; the answer in hand is not.
 */
export function cacheStore(key: string, value: string): boolean {
  try {
    writeStore(key, value);
    return true;
  } catch (err) {
    console.warn(
      `[data] konnte ${key} nicht zwischenspeichern (${err instanceof Error ? err.name : "Fehler"}) — die Daten dieser Sitzung stehen trotzdem.`,
    );
    return false;
  }
}
