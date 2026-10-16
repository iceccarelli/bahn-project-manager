import { createHash } from "node:crypto";

/**
 * The id an OIDC identity acts under, everywhere (notifications.userId, project_watchers.userId, audit actors, idempotency
 * keys): `o` + the first 31 hex characters of sha256 of the stored openId (`oidc:<tid>:<oid>`). Stable, fits the 64-char
 * actor columns, never a raw tenant/object id. `users.principalId` stores the same value (migration 0014 backfills it with
 * MySQL's SHA2, which this test-pinned function must keep agreeing with).
 */
export const principalIdForOpenId = (openId: string): string => `o${createHash("sha256").update(openId).digest("hex").slice(0, 31)}`;
