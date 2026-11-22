import { Hono } from "hono"
import { routePath } from "hono/route"
import { createShellServer, mountStatic } from "@zsrobinson/shell/server"
import { createApi } from "./api.ts"
import { moneyMetrics } from "./metrics.ts"
import type { Model } from "./model.ts"

/**
 * The production app. Every route but /metrics sits behind the shell's
 * Cloudflare Access check: a request needs a valid Access JWT, wherever it
 * comes from, loopback included. /metrics needs the scrape token and carries
 * bounded gauges only.
 */
export function createMoneyServer(
  model: Model,
  options: {
    issuer: string
    audience: string
    publicOrigin: string
    services: () => unknown
    metricsToken?: string
    syncHealthFile?: string
    /** Request metadata sink; the shell default is one JSON line on stdout. */
    log?: (metadata: {
      method: string
      route: string
      status: number
      durationMs: number
    }) => void
  }
) {
  const errors = new Map<string, number>()
  const scrape = (r: Request) =>
    Boolean(options.metricsToken) &&
    r.headers.get("Authorization") === `Bearer ${options.metricsToken}`
  const shell = createShellServer({
    issuer: options.issuer,
    audience: options.audience,
    publicOrigin: options.publicOrigin,
    services: options.services,
    metrics: { authorize: scrape },
    log: options.log,
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
    return c.text(
      (await base.text()) + moneyMetrics(model, errors, options.syncHealthFile),
      200,
      { "Content-Type": "text/plain; version=0.0.4" }
    )
  })
  app.all("*", (c) => shell.fetch(c.req.raw))
  return app
}
