// Loopback-only server over invented fixture databases, for development and
// screenshots. It has no Access check, so it refuses any non-loopback bind and
// any database outside the fixture directory.
import { resolve } from "node:path"
import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { createApi } from "./api.ts"
import { openAppDb } from "./app-db.ts"
import { detailStore } from "./detail.ts"
import { createModel } from "./model.ts"
import { assertLoopback, fixturePaths } from "./fixture-guard.ts"

const host = process.env.BIND_ADDRESS || "127.0.0.1"
assertLoopback(host)
const paths = fixturePaths(
  process.env,
  resolve(import.meta.dirname, "../fixtures/out")
)
const detailPath = paths.detail
const appPath = paths.app

const store = detailStore(detailPath)
const fixedToday = process.env.MONEY_TODAY
const today = () =>
  fixedToday ??
  store
    .get()
    .transactions.reduce(
      (max, t) => (t.date > max ? t.date : max),
      "1970-01-01"
    )
const model = createModel(store, openAppDb(appPath), today)

const app = new Hono()
app.get("/api/session", (c) =>
  c.json({ email: "you@example.test", services: [] })
)
app.route("/api", createApi(model))
if (process.env.SERVE_DIST) {
  app.use("/*", serveStatic({ root: "./dist" }))
  app.get("*", serveStatic({ path: "./dist/index.html" }))
}
serve({
  fetch: app.fetch,
  hostname: host,
  port: Number(process.env.PORT || 8787),
})
console.log(`Fixture API on http://${host}:${process.env.PORT || 8787}`)
