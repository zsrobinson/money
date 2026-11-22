import { readFileSync } from "node:fs"
import { serve } from "@zsrobinson/shell/server"
import { createMoneyServer } from "./app.ts"
import { openAppDb } from "./app-db.ts"
import { detailStore } from "./detail.ts"
import { createModel } from "./model.ts"
import { assertLoopback, assertProductionPaths } from "./fixture-guard.ts"

const required = (key: string) => {
  const value = process.env[key]
  if (!value) throw Error(`Missing ${key}`)
  return value
}

// Cloudflare Tunnel reaches the app on loopback; never listen publicly.
const host = process.env.BIND_ADDRESS || "127.0.0.1"
assertLoopback(host)
// Production databases open only in the production service, and the
// production service opens nothing else.
assertProductionPaths(process.env)
const db = openAppDb(required("MONEY_APP_DB"))
if (process.env.MONEY_MIGRATE_ONLY === "true") {
  db.close()
  console.log(JSON.stringify({ migrated: true }))
  process.exit(0)
}

const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: process.env.TZ || "UTC" })
const model = createModel(detailStore(required("MONEY_DETAIL_DB")), db, today)
const app = createMoneyServer(model, {
  issuer: required("ACCESS_ISSUER"),
  audience: required("ACCESS_AUD"),
  publicOrigin: required("PUBLIC_ORIGIN"),
  services: () =>
    JSON.parse(readFileSync(required("SERVICE_MANIFEST"), "utf8")),
  metricsToken: process.env.METRICS_TOKEN,
  syncHealthFile: process.env.MONEY_SYNC_HEALTH_FILE,
})

serve({
  fetch: app.fetch,
  hostname: host,
  port: Number(process.env.PORT || 8787),
})
