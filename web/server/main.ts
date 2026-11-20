import { readFileSync } from "node:fs"
import { Hono } from "hono"
import { routePath } from "hono/route"
import { createShellServer, mountStatic, serve } from "@zsrobinson/shell/server"
import { createApi } from "./api.ts"
import { openAppDb } from "./app-db.ts"
import { detailStore } from "./detail.ts"
import { moneyMetrics } from "./metrics.ts"
import { createModel } from "./model.ts"
import { assertLoopback } from "./fixture-guard.ts"

const required = (key: string) => {
  const value = process.env[key]
  if (!value) throw Error(`Missing ${key}`)
  return value
}

// Cloudflare Tunnel reaches the app on loopback; never listen publicly.
const host = process.env.BIND_ADDRESS || "127.0.0.1"
assertLoopback(host)
const db = openAppDb(required("MONEY_APP_DB"))
if (process.env.MONEY_MIGRATE_ONLY === "true") {
  db.close()
  console.log(JSON.stringify({ migrated: true }))
  process.exit(0)
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: process.env.TZ || "UTC" })
const model = createModel(detailStore(required("MONEY_DETAIL_DB")), db, today)
const errors = new Map<string, number>()
const scrape = (r: Request) =>
  Boolean(process.env.METRICS_TOKEN) &&
  r.headers.get("Authorization") === `Bearer ${process.env.METRICS_TOKEN}`

const shell = createShellServer({
  issuer: required("ACCESS_ISSUER"),
  audience: required("ACCESS_AUD"),
  publicOrigin: required("PUBLIC_ORIGIN"),
  services: () => JSON.parse(readFileSync(required("SERVICE_MANIFEST"), "utf8")),
  metrics: { authorize: scrape },
})
shell.use("/api/*", async (c, next) => {
  await next()
  if (c.res.status >= 500) {
    const route = routePath(c) || "unmatched"
    errors.set(route, (errors.get(route) ?? 0) + 1)
  }
})
shell.route("/api", createApi(model))
mountStatic(shell)

// Money freshness gauges join the shell series on the same scrape.
const app = new Hono()
app.get("/metrics", async (c) => {
  const base = await shell.fetch(c.req.raw)
  if (!base.ok) return base
  return c.text((await base.text()) + moneyMetrics(model, errors, process.env.MONEY_SYNC_HEALTH_FILE), 200, {
    "Content-Type": "text/plain; version=0.0.4",
  })
})
app.all("*", (c) => shell.fetch(c.req.raw))

serve({
  fetch: app.fetch,
  hostname: host,
  port: Number(process.env.PORT || 8787),
})
