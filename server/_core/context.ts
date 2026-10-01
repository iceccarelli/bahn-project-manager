import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import type { Principal } from "../domain/permissions";
import { newRequestId, traceIdFrom } from "../observability/trace";
import { resolveIdentity } from "./identity";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  /** legacy users row (kept for procedures written before Principal existed) */
  user: User | null;
  /** verified identity + authorization data; the only thing new code may trust */
  principal: Principal | null;
  traceId: string;
  requestId: string;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  const identity = await resolveIdentity(opts.req);
  const traceId = traceIdFrom(opts.req.headers);
  const requestId = newRequestId();
  opts.res.setHeader("x-trace-id", traceId);
  opts.res.setHeader("x-request-id", requestId);
  return {
    req: opts.req,
    res: opts.res,
    user: identity?.user ?? null,
    principal: identity?.principal ?? null,
    traceId,
    requestId,
  };
}
