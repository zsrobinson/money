import { readFileSync } from "node:fs"
import type { Model } from "./model.ts"

/** Sync outcome marker written by the sync unit: {last_attempt_at, success}. Never financial data. */
export function syncHealth(path: string | undefined) {
  if (!path) return undefined
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      last_attempt_at?: unknown
      success?: unknown
    }
    const at = Number(raw.last_attempt_at)
    return {
      success: raw.success === true ? 1 : 0,
      lastAttempt: Number.isFinite(at) && at > 0 ? at : 0,
    }
  } catch {
    // Missing or unreadable before the first sync counts as not yet successful.
    return { success: 0, lastAttempt: 0 }
  }
}

/** Freshness and failure gauges. Bounded labels only: no ids, names or amounts. */
export function moneyMetrics(
  model: Model,
  errors: Map<string, number>,
  syncHealthFile?: string
) {
  const lines: string[] = []
  const gauge = (name: string, value: number, labels = "") => {
    lines.push(
      `${name}${labels ? `{${labels}}` : ""} ${Number.isFinite(value) ? value : 0}`
    )
  }
  let up: number
  let generated = 0
  let schema = 0
  const statuses: Record<string, number> = {
    healthy: 0,
    stale: 0,
    error: 0,
    disabled: 0,
  }
  let oldestSuccess = 0
  try {
    const detail = model.store.get()
    up = model.store.status().error ? 0 : 1
    schema = detail.schemaVersion
    generated = detail.generatedAt ? Date.parse(detail.generatedAt) / 1000 : 0
    const now = Date.now() / 1000
    for (const s of detail.sources) {
      const key = s.status in statuses ? s.status : "error"
      statuses[key]++
      const last = s.lastSuccessAt ? Date.parse(s.lastSuccessAt) / 1000 : 0
      if (s.status !== "disabled")
        oldestSuccess = Math.max(oldestSuccess, last ? now - last : now)
    }
  } catch {
    up = 0
  }
  let appUp = 1
  try {
    model.db.prepare("SELECT version FROM schema_version").get()
  } catch {
    appUp = 0
  }
  lines.push("# TYPE money_detail_up gauge")
  gauge("money_detail_up", up)
  lines.push("# TYPE money_detail_generated_timestamp_seconds gauge")
  gauge("money_detail_generated_timestamp_seconds", generated)
  lines.push("# TYPE money_detail_age_seconds gauge")
  gauge(
    "money_detail_age_seconds",
    generated ? Date.now() / 1000 - generated : 0
  )
  lines.push("# TYPE money_detail_schema_version gauge")
  gauge("money_detail_schema_version", schema)
  lines.push("# TYPE money_app_db_up gauge")
  gauge("money_app_db_up", appUp)
  lines.push("# TYPE money_sources gauge")
  for (const [status, count] of Object.entries(statuses))
    gauge("money_sources", count, `status="${status}"`)
  lines.push("# TYPE money_source_last_success_age_seconds_max gauge")
  gauge("money_source_last_success_age_seconds_max", oldestSuccess)
  const sync = syncHealth(syncHealthFile)
  if (sync) {
    lines.push("# TYPE money_sync_success gauge")
    gauge("money_sync_success", sync.success)
    lines.push("# TYPE money_sync_last_attempt_timestamp_seconds gauge")
    gauge("money_sync_last_attempt_timestamp_seconds", sync.lastAttempt)
  }
  lines.push("# TYPE money_api_errors_total counter")
  for (const [route, count] of errors)
    gauge("money_api_errors_total", count, `route=${JSON.stringify(route)}`)
  return lines.join("\n") + "\n"
}
