import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const safe = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9._:-]{8,64}$/.test(v) ? v : null);

/** W3C traceparent → x-trace-id → x-request-id → fresh. Untrusted input is length/charset-bounded. */
export function traceIdFrom(h: IncomingHttpHeaders): string {
  const tp = typeof h.traceparent === "string" ? TRACEPARENT.exec(h.traceparent) : null;
  return tp?.[1] ?? safe(h["x-trace-id"]) ?? safe(h["x-request-id"]) ?? randomBytes(16).toString("hex");
}
export const newRequestId = () => randomBytes(8).toString("hex");
