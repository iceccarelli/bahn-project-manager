import { expect, vi } from "vitest";

/**
 * Test timeout for the suites that talk to a real MySQL (`*.db.test.ts`).
 *
 * `createTestDatabase()` creates a schema and replays every migration statement
 * by statement. Most suites call it inside the `it()` body, where vitest's 5 s
 * *test* timeout applies — `hookTimeout` (60 s, vitest.config.ts) only covers
 * `beforeAll`/`beforeEach`. On a cold CI runner, with files running in parallel,
 * provisioning alone can pass 5 s, so a correct test failed with "Test timed
 * out" (readModels.db.test.ts, PR 4's `test` job).
 *
 * Only DB suites get the longer limit: every other test keeps the 5 s default,
 * so a hang in pure logic is still caught quickly.
 */
if (/\.db\.test\.ts$/.test(expect.getState().testPath ?? "")) {
  vi.setConfig({ testTimeout: 60_000 });
}
