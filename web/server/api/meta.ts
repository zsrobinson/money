import { Hono } from "hono"
import { earliestDate } from "../analytics.ts"
import { normalizeText } from "../normalize.ts"
import { z } from "zod"
import {
  body,
  HttpError,
  isDate,
  notFound,
  now,
  SettingsBody,
  txnJson,
  type Ctx,
} from "./context.ts"

const SYNC_COOLDOWN_MS = 5 * 60_000

export function registerMeta(api: Hono, ctx: Ctx) {
  const { model, write, settings, setSetting } = ctx
  api.get("/meta", (c) => {
    const m = model.get()
    const s = model.store.status()
    return c.json({
      today: m.today,
      earliest: earliestDate(m),
      generatedAt: s.generatedAt,
      schemaVersion: s.schemaVersion,
      stale: Boolean(s.error),
      sources: m.detail.sources.map((x) => ({
        id: x.id,
        institution: x.institution,
        kind: x.kind,
        status: x.status,
        lastSuccessAt: x.lastSuccessAt,
        dataKinds: x.dataKinds,
        syncRequestedAt: settings().syncRequests[x.id] ?? null,
        accounts: m.accounts.filter((a) => a.sourceId === x.id).length,
      })),
      settings: settings(),
      unreviewed: m.txns.filter((t) => t.needsReview).length,
      manualAccounts: m.accounts.filter((a) => a.manual).length,
    })
  })

  /**
   * Ask the sync service for an early sync. The sync side reads this
   * metadata on a one-minute timer and runs the normal sync, at most once
   * every five minutes; the web user never reaches credentials.
   */
  const requestSync = () => {
    const m = model.get()
    const last = Object.values(settings().syncRequests).reduce(
      (max, v) => (v > max ? v : max),
      ""
    )
    const waited = last ? Date.now() - Date.parse(last) : Infinity
    if (waited < SYNC_COOLDOWN_MS)
      throw new HttpError(
        429,
        `A sync was requested ${Math.max(1, Math.round(waited / 60_000))} min ago; try again in ${Math.ceil((SYNC_COOLDOWN_MS - waited) / 60_000)} min`
      )
    const at = now()
    const next = Object.fromEntries(
      m.detail.sources
        .filter((x) => x.status !== "disabled")
        .map((x) => [x.id, at])
    )
    write(() => setSetting("syncRequests", next))
    return at
  }
  api.post("/sync", (c) => c.json({ requestedAt: requestSync() }, 202))
  api.post("/sources/:id/sync", (c) => {
    const m = model.get()
    const source = m.detail.sources.find((x) => x.id === c.req.param("id"))
    if (!source) throw notFound("Connection")
    return c.json({ requestedAt: requestSync() }, 202)
  })
  api.get("/settings", (c) => c.json(settings()))
  api.patch("/settings", async (c) => {
    const b = await body(c, SettingsBody.omit({ syncRequests: true }))
    const m = model.get()
    const before = settings()
    write(() => {
      for (const [key, value] of Object.entries(b))
        setSetting(key as keyof typeof b, value)
      // Turning review on starts the queue today.
      if (b.reviewNewTransactions && !before.reviewNewTransactions)
        setSetting("reviewSince", m.today)
    })
    return c.json(settings())
  })
  /** "Mark everything before today reviewed": the queue starts today. */
  api.post("/review/start", async (c) => {
    const b = await body(
      c,
      z.object({ since: z.string().refine(isDate).optional() }).strict()
    )
    const since = b.since ?? model.get().today
    write(() => setSetting("reviewSince", since))
    return c.json({ reviewSince: since })
  })

  api.get("/search", (c) => {
    const m = model.get()
    const needle = normalizeText(c.req.query("q") ?? "")
    if (!needle)
      return c.json({
        accounts: [],
        merchants: [],
        categories: [],
        transactions: [],
      })
    const merchants = new Map<
      string,
      { key: string; name: string; count: number }
    >()
    for (const t of m.txns) {
      if (!t.merchantKey || !t.merchantKey.includes(needle)) continue
      const r = merchants.get(t.merchantKey) ?? {
        key: t.merchantKey,
        name: t.merchantEff ?? t.merchantKey,
        count: 0,
      }
      r.count++
      merchants.set(t.merchantKey, r)
    }
    return c.json({
      accounts: m.accounts
        .filter((a) =>
          normalizeText(`${a.name} ${a.institution}`).includes(needle)
        )
        .slice(0, 6)
        .map((a) => ({ id: a.id, name: a.name, institution: a.institution })),
      merchants: [...merchants.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      categories: m.categories
        .filter((x) => normalizeText(x.label).includes(needle))
        .slice(0, 6)
        .map((x) => ({ code: x.code, label: x.label })),
      // Newest first; merchant, bank description, note or exact amount.
      transactions: m.txns
        .filter((t) => {
          if (t.hidden) return false
          const amount = (Math.abs(t.amountCents) / 100).toFixed(2)
          return (
            normalizeText(
              `${t.merchantEff ?? ""} ${t.description ?? ""} ${t.note ?? ""}`
            ).includes(needle) || amount.startsWith(needle.replace(/^\$/, ""))
          )
        })
        .slice(0, 8)
        .map((t) => txnJson(m, t)),
    })
  })
}
