import assert from "node:assert/strict";
import test from "node:test";
import { retryDelayMs } from "./queue";

test("retry delay grows exponentially and is capped at five minutes", () => {
  assert.equal(retryDelayMs(1), 1_000);
  assert.equal(retryDelayMs(2), 2_000);
  assert.equal(retryDelayMs(3), 4_000);
  assert.equal(retryDelayMs(4), 8_000);
  assert.equal(retryDelayMs(20), 300_000);
});

test("attempt values below one use the first retry delay", () => {
  assert.equal(retryDelayMs(0), 1_000);
  assert.equal(retryDelayMs(-5), 1_000);
});
