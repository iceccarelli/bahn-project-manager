import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { AggregateConflictError, ConflictError, DomainError } from "../domain/errors";
import { m } from "../observability/metrics";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Structured conflict payload for the client's merge/replace UI.
    const conflict = error.cause instanceof ConflictError || error.cause instanceof AggregateConflictError ? error.cause.info : undefined;
    return { ...shape, data: { ...shape.data, ...(conflict ? { conflict } : {}) } };
  },
});

export const router = t.router;

/** Latency histogram for every procedure, labelled by path and type. */
const timing = t.middleware(async ({ path, type, next }) => {
  const start = performance.now();
  try {
    return await next();
  } finally {
    m.httpMs.observe(performance.now() - start, { path, type });
  }
});

/** DomainError → TRPCError, so the domain layer stays free of transport concepts. */
const domainErrors = t.middleware(async ({ next }) => {
  const res = await next();
  // Pool exhaustion is overload, not a bug: answer with explicit backpressure
  // (429) that idempotent clients retry, instead of an opaque 500.
  if (!res.ok && /Queue limit reached|Pool is closed|connect ETIMEDOUT/i.test(String((res.error.cause as Error | undefined)?.message ?? ""))) {
    m.shed.inc();
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Server ausgelastet, bitte erneut versuchen", cause: res.error.cause });
  }
  if (!res.ok && res.error.cause instanceof DomainError) {
    const e = res.error.cause;
    const code =
      e.code === "NOT_FOUND" ? "NOT_FOUND"
      : e.code === "FORBIDDEN" ? "FORBIDDEN"
      : e.code === "VERSION_CONFLICT" ? "CONFLICT"
      : e.code === "IDEMPOTENCY_KEY_REUSE" ? "UNPROCESSABLE_CONTENT"
      : "BAD_REQUEST";
    throw new TRPCError({ code, message: e.message, cause: e });
  }
  return res;
});

export const publicProcedure = t.procedure.use(timing).use(domainErrors);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.principal) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      principal: ctx.principal,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireUser);

export const adminProcedure = publicProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (ctx.principal?.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        principal: ctx.principal,
      },
    });
  }),
);
