import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openAppDb } from "../server/app-db.ts"
import { detailStore } from "../server/detail.ts"
import { moneyMetrics, syncHealth } from "../server/metrics.ts"
import { createModel } from "../server/model.ts"
import { FIXTURE_TODAY, generate } from "../fixtures/generate.ts"

test("sync health marker is optional and defaults to not yet successful", () => {
  const dir = mkdtempSync(join(tmpdir(), "money-metrics-"))
  assert.equal(syncHealth(undefined), undefined)
  assert.deepEqual(syncHealth(join(dir, "missing.json")), { success: 0, lastAttempt: 0 })
  writeFileSync(join(dir, "ok.json"), JSON.stringify({ last_attempt_at: 1795000000, success: true }))
  assert.deepEqual(syncHealth(join(dir, "ok.json")), { success: 1, lastAttempt: 1795000000 })
  writeFileSync(join(dir, "bad.json"), "{")
  assert.deepEqual(syncHealth(join(dir, "bad.json")), { success: 0, lastAttempt: 0 })
})

test("money metrics carry gauges only, no names, ids or amounts", () => {
  const dir = mkdtempSync(join(tmpdir(), "money-metrics-"))
  const paths = generate(dir)
  const model = createModel(detailStore(paths.detailPath), openAppDb(paths.appPath), () => FIXTURE_TODAY)
  writeFileSync(join(dir, "health.json"), JSON.stringify({ last_attempt_at: 1795000000, success: false }))
  const text = moneyMetrics(model, new Map([["/api/summary", 2]]), join(dir, "health.json"))
  assert.match(text, /^money_detail_up 1$/m)
  assert.match(text, /^money_sync_success 0$/m)
  assert.match(text, /^money_sync_last_attempt_timestamp_seconds 1795000000$/m)
  assert.match(text, /^money_sources\{status="stale"\} 1$/m)
  assert.doesNotMatch(text, /acct_|src_|txn_|Example|Harbor/)
  assert.doesNotMatch(moneyMetrics(model, new Map()), /money_sync_success/)
})
