/**
 * Addresses an operator supplied for a department the workbook left empty.
 *
 * Persisted the same way every other edit on this site is — localStorage, with
 * an entry in the Änderungshistorie — so supplying one is as traceable and as
 * reversible as changing a status. The address never comes from here; it comes
 * from a person who knows it, and the record says who and when.
 *
 * ---------------------------------------------------------------------------
 * One store, every subscriber
 * ---------------------------------------------------------------------------
 * The first version kept the list in `useState` per hook instance. The wizard's
 * step 5 and the panel inside it each called the hook, so each had its own
 * copy: entering an address updated the panel and localStorage, and the step
 * around it went on reporting LST as unreachable — the warning could not be
 * cleared by the control built to clear it. `storage` events do not help,
 * because the browser fires them for OTHER documents only.
 *
 * A module-level store with `useSyncExternalStore` is the fix: one list, one
 * snapshot, and every component that reads it re-renders on a write, wherever
 * in the tree it sits.
 */
import { useCallback, useSyncExternalStore } from "react";
import {
  normalizeOverride,
  validateOverride,
  type OverrideProblem,
  type RecipientOverride,
} from "@shared/contact-overrides";

const KEY = "bahn-recipient-overrides";

function readStorage(): RecipientOverride[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RecipientOverride[]) : [];
  } catch {
    /* A corrupted store must not take the page down with it. An empty list is
       the honest answer: it reports "reaches nobody", which is the state the
       workbook is in anyway. */
    return [];
  }
}

const listeners = new Set<() => void>();
/* Cached, because useSyncExternalStore compares snapshots by identity and
   parsing JSON on every render would hand it a new array every time. */
let snapshot: RecipientOverride[] = readStorage();

function publish(next: RecipientOverride[]) {
  snapshot = next;
  window.localStorage.setItem(KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  /* Another tab supplying an address is the same event as this one doing it. */
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    snapshot = readStorage();
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: RecipientOverride[] = [];

export function useRecipientOverrides() {
  const overrides = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );

  const add = useCallback(
    (
      input: { department: string; name: string; mail: string },
      addedBy: string,
    ): OverrideProblem | null => {
      const problem = validateOverride(input);
      if (problem) return problem;
      const entry = normalizeOverride(input, addedBy, new Date().toISOString());
      publish([
        ...readStorage().filter(
          (o) => !(o.department === entry.department && o.mail === entry.mail),
        ),
        entry,
      ]);
      return null;
    },
    [],
  );

  const remove = useCallback((department: string, mail: string) => {
    publish(
      readStorage().filter((o) => !(o.department === department && o.mail === mail)),
    );
  }, []);

  /** For tests and for a reader who wants to start over. */
  const clear = useCallback(() => publish([]), []);

  return { overrides, add, remove, clear };
}
