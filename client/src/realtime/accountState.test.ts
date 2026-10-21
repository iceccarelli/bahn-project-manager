import { describe, expect, it } from "vitest";
import {
  ABNAHME_SESSION_PREFIX, LAST_PRINCIPAL_KEY, RECENT_SEARCHES_KEY, RECIPIENT_OVERRIDES_KEY,
  onUserStateReset, purgeUserScopedState, reconcilePrincipal, signOutCleanup, type AccountStores, type KeyedStore,
} from "./accountState";

const mem = (): KeyedStore & { dump: () => Record<string, string> } => {
  const m = new Map<string, string>();
  return {
    getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k),
    get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, dump: () => Object.fromEntries(m),
  };
};
const stores = () => ({ local: mem(), session: mem() });
const fill = (s: ReturnType<typeof stores>) => {
  s.local.setItem(RECENT_SEARCHES_KEY, '["G.992031294"]');
  s.local.setItem(RECIPIENT_OVERRIDES_KEY, '[{"department":"LST","address":"x@bahn.example"}]');
  s.session.setItem(`${ABNAHME_SESSION_PREFIX}:ELA:481`, '{"answers":{"a":1}}');
  s.session.setItem(`${ABNAHME_SESSION_PREFIX}:ZIM:frei`, '{"answers":{}}');
  s.local.setItem("theme", "dark"); s.local.setItem("sidebar-width", "280"); s.session.setItem("abnahme:v2:other", "keep"); s.session.setItem("bahn.access_token", "TOKEN-A");
};

describe("purgeUserScopedState", () => {
  it("removes exactly the registered personal state and leaves UI preferences and unrelated keys alone", () => {
    const s = stores(); fill(s);
    purgeUserScopedState(s);
    expect(Object.keys(s.local.dump()).sort()).toEqual(["sidebar-width", "theme"]);
    expect(Object.keys(s.session.dump()).sort()).toEqual(["abnahme:v2:other", "bahn.access_token"]); // the token is oidcClient.clearAuth's job
  });
  it("resets registered in-memory copies, survives a throwing hook and a throwing storage", () => {
    const s = stores(); fill(s);
    let ran = 0;
    const off1 = onUserStateReset(() => { throw new Error("boom"); });
    const off2 = onUserStateReset(() => { ran++; });
    purgeUserScopedState(s);
    expect(ran).toBe(1);
    off1(); off2();
    const broken: KeyedStore = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); }, length: 1, key: () => { throw new Error("denied"); } };
    expect(() => purgeUserScopedState({ local: broken, session: broken } as AccountStores)).not.toThrow();
  });
});

describe("reconcilePrincipal — who is signed in decides what may be inherited", () => {
  it("first sign-in adopts the browser; the same person returning (expiry bounce) keeps their state", () => {
    const s = stores(); fill(s);
    expect(reconcilePrincipal("oAAA", s)).toBe("first");
    expect(s.local.getItem(RECENT_SEARCHES_KEY)).not.toBeNull();
    expect(reconcilePrincipal("oAAA", s)).toBe("same");
    expect(s.session.getItem(`${ABNAHME_SESSION_PREFIX}:ELA:481`)).not.toBeNull();
  });
  it("a different person inherits nothing — and the first person does not get it back later", () => {
    const s = stores(); reconcilePrincipal("oAAA", s); fill(s);
    expect(reconcilePrincipal("oBBB", s)).toBe("switched");
    expect(s.local.getItem(RECENT_SEARCHES_KEY)).toBeNull();
    expect(s.local.getItem(RECIPIENT_OVERRIDES_KEY)).toBeNull();
    expect(s.session.getItem(`${ABNAHME_SESSION_PREFIX}:ELA:481`)).toBeNull();
    expect(s.local.getItem(LAST_PRINCIPAL_KEY)).toBe("oBBB");
    s.local.setItem(RECENT_SEARCHES_KEY, '["B-only"]');
    expect(reconcilePrincipal("oAAA", s)).toBe("switched");
    expect(s.local.getItem(RECENT_SEARCHES_KEY)).toBeNull(); // B's state is not inherited by A either
  });
  it("two identities with the same display name are still two people: the marker is the principal id", () => {
    const s = stores(); reconcilePrincipal("oAAA", s); fill(s);
    expect(reconcilePrincipal("oAAB", s)).toBe("switched");
    expect(s.local.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });
  it("the marker holds an opaque id only", () => {
    const s = stores(); reconcilePrincipal("o0123abcd", s);
    expect(s.local.dump()).toEqual({ [LAST_PRINCIPAL_KEY]: "o0123abcd" });
  });
});

describe("signOutCleanup", () => {
  it("purges and forgets, so the next person is a first sign-in and compared with nobody", () => {
    const s = stores(); reconcilePrincipal("oAAA", s); fill(s);
    signOutCleanup(s);
    expect(s.local.getItem(LAST_PRINCIPAL_KEY)).toBeNull();
    expect(s.local.getItem(RECENT_SEARCHES_KEY)).toBeNull();
    expect(reconcilePrincipal("oBBB", s)).toBe("first");
  });
});
