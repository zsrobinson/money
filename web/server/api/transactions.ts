import { Hono } from "hono"
import { z } from "zod"
import { isDate } from "../analytics.ts"
import { compileMatch, matchText, RuleMatch } from "../rules.ts"
import type { Computed, EffTxn } from "../model.ts"
import { normalizeText } from "../normalize.ts"
import {
  body,
  HttpError,
  id,
  notFound,
  now,
  txnJson,
  type Ctx,
} from "./context.ts"
import { SplitsBody, TxnPatch } from "./schemas.ts"

const STATUSES = [
  "unreviewed",
  "reviewed",
  "hidden",
  "pending",
  "split",
  "manual",
  "all",
] as const

/** The transaction list's filters, from a URL query or a bulk edit's filter. */
export function parseQuery(q: Record<string, string | undefined>) {
  return {
    q: (q.q ?? "").slice(0, 100),
    account: q.account,
    category: q.category,
    merchant: q.merchant,
    match: (() => {
      if (!q.match) return undefined
      try {
        const parsed = RuleMatch.safeParse(JSON.parse(q.match))
        return parsed.success ? parsed.data : undefined
      } catch {
        return undefined
      }
    })(),
    tag: q.tag,
    from: isDate(q.from) ? q.from : undefined,
    to: isDate(q.to) ? q.to : undefined,
    min: q.min && /^\d+$/.test(q.min) ? Number(q.min) : undefined,
    max: q.max && /^\d+$/.test(q.max) ? Number(q.max) : undefined,
    direction:
      q.direction === "in" || q.direction === "out" ? q.direction : undefined,
    flow: ["activity", "bank_transfer", "peer_payment"].includes(q.flow ?? "")
      ? q.flow
      : undefined,
    status: (STATUSES as readonly string[]).includes(q.status ?? "")
      ? (q.status as (typeof STATUSES)[number])
      : ("visible" as const),
    sort: ["date", "amount", "merchant"].includes(q.sort ?? "")
      ? (q.sort as "date" | "amount" | "merchant")
      : ("date" as const),
    order: q.order === "asc" ? ("asc" as const) : ("desc" as const),
    offset: Math.max(0, Number(q.offset) || 0),
    limit: Math.min(200, Math.max(1, Number(q.limit) || 50)),
  }
}
export type TxnFilter = ReturnType<typeof parseQuery>

/** Filtered and sorted exactly as the list shows them. */
export function listTxns(
  m: Computed,
  f: TxnFilter,
  options: { showPending?: boolean } = {}
) {
  const needle = normalizeText(f.q)
  const matches = f.match ? compileMatch(f.match) : undefined
  const categoryCodes = f.category
    ? new Set(
        m.categories
          .filter((x) => x.code === f.category || x.parent === f.category)
          .map((x) => x.code)
      )
    : undefined
  let list = m.txns.filter((t) => {
    if (f.status === "visible" && t.hidden) return false
    if (f.status === "visible" && options.showPending === false && t.pending)
      return false
    if (f.status === "hidden" && !t.hidden) return false
    if (f.status === "unreviewed" && !t.needsReview) return false
    if (f.status === "reviewed" && (!t.reviewed || t.hidden)) return false
    if (f.status === "pending" && !t.pending) return false
    if (f.status === "split" && !t.splits?.length) return false
    if (f.status === "manual" && !t.manual) return false
    if (f.account && t.accountId !== f.account) return false
    if (
      categoryCodes &&
      !categoryCodes.has(t.categoryEff) &&
      !t.splits?.some((s) => categoryCodes.has(s.category))
    )
      return false
    if (f.merchant && t.merchantKey !== f.merchant) return false
    if (matches && !matches(t, matchText(t))) return false
    if (f.tag && !t.tags.includes(f.tag)) return false
    if (f.from && t.date < f.from) return false
    if (f.to && t.date > f.to) return false
    if (f.flow && t.flowKind !== f.flow) return false
    if (f.direction === "in" && t.amountCents <= 0) return false
    if (f.direction === "out" && t.amountCents >= 0) return false
    const abs = Math.abs(t.amountCents)
    if (f.min !== undefined && abs < f.min) return false
    if (f.max !== undefined && abs > f.max) return false
    if (needle) {
      const hay = normalizeText(
        [
          t.merchantEff,
          t.description,
          t.note,
          m.category(t.categoryEff).label,
          m.account.get(t.accountId)?.name,
        ].join(" ")
      )
      if (!hay.includes(needle)) return false
    }
    return true
  })
  const dir = f.order === "asc" ? 1 : -1
  if (f.sort === "amount")
    list = list.toSorted(
      (a, b) => (Math.abs(a.amountCents) - Math.abs(b.amountCents)) * dir
    )
  else if (f.sort === "merchant")
    list = list.toSorted(
      (a, b) => (a.merchantEff ?? "").localeCompare(b.merchantEff ?? "") * dir
    )
  else if (f.order === "asc") list = list.toReversed()
  return list
}

const ManualTxn = z
  .object({
    accountId: z.string().min(1),
    date: z.string().refine(isDate, "Use a valid date"),
    amountCents: z
      .number()
      .int()
      .refine((v) => v !== 0, "Enter an amount")
      .refine((v) => Math.abs(v) <= 1e12, "That amount is too large"),
    merchant: z.string().trim().min(1).max(200).nullable().optional(),
    category: z.string().min(1).max(100),
    note: z.string().trim().max(2000).nullable().optional(),
    tags: z.array(z.string().max(100)).max(20).optional(),
  })
  .strict()

const BulkPatch = z
  .object({
    category: z.string().min(1).max(100).optional(),
    merchant: z.string().trim().min(1).max(200).nullable().optional(),
    hidden: z.boolean().nullable().optional(),
    reviewed: z.boolean().nullable().optional(),
    date: z.string().refine(isDate, "Use a valid date").nullable().optional(),
  })
  .strict()

export function registerTransactions(api: Hono, ctx: Ctx) {
  const { model, db, write, validCategory, settings } = ctx
  const list = (m: Computed, q: Record<string, string | undefined>) =>
    listTxns(m, parseQuery(q), { showPending: settings().showPending })

  api.get("/transactions", (c) => {
    const m = model.get()
    const f = parseQuery(c.req.query())
    const items = list(m, c.req.query())
    // Money in and out leaves out transfers between your own accounts and
    // hidden transactions, like every other total.
    const counted = (t: EffTxn) =>
      t.hidden
        ? []
        : (t.splits?.length
            ? t.splits.map((x) => ({ c: x.category, cents: x.amountCents }))
            : [{ c: t.categoryEff, cents: t.amountCents }]
          ).filter((x) => m.category(x.c).group !== "transfer")
    let inflow = 0
    let outflow = 0
    for (const t of items)
      for (const x of counted(t))
        if (x.cents > 0) inflow += x.cents
        else outflow += x.cents
    const page = items.slice(f.offset, f.offset + f.limit)
    const byDay = new Map<string, number[]>()
    for (const t of items)
      for (const x of counted(t))
        byDay.set(t.date, [...(byDay.get(t.date) ?? []), x.cents])
    return c.json({
      total: items.length,
      inflowCents: inflow,
      outflowCents: outflow,
      offset: f.offset,
      items: page.map((t) => txnJson(m, t)),
      // Net of every matching transaction on each day shown, across pages.
      // A day of only transfers has no total.
      dayTotals: Object.fromEntries(
        [...new Set(page.map((t) => t.date))].flatMap((date) => {
          const parts = byDay.get(date)
          return parts?.length
            ? [[date, parts.reduce((sum, x) => sum + x, 0)]]
            : []
        })
      ),
    })
  })
  api.get("/transactions.csv", (c) => {
    const m = model.get()
    const rows = listTxns(m, parseQuery(c.req.query()))
    const tagName = new Map(m.tags.map((t) => [t.id, t.name]))
    // Quote every cell and neutralise spreadsheet formulas.
    const cell = (v: string | number | null | undefined) => {
      let text = v == null ? "" : String(v)
      if (typeof v === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
      return `"${text.replace(/"/g, '""')}"`
    }
    const lines = [
      [
        "Date",
        "Merchant",
        "Description",
        "Category",
        "Account",
        "Amount",
        "Currency",
        "Status",
        "Tags",
        "Note",
      ]
        .map(cell)
        .join(","),
      ...rows.map((t) =>
        [
          t.date,
          t.merchantEff,
          t.description,
          t.splits?.length
            ? t.splits.map((x) => m.category(x.category).label).join(" + ")
            : m.category(t.categoryEff).label,
          m.account.get(t.accountId)?.name,
          (t.amountCents / 100).toFixed(2),
          t.currency,
          t.pending
            ? "Pending"
            : t.hidden
              ? "Hidden"
              : t.needsReview
                ? "Needs review"
                : "Reviewed",
          t.tags.map((x) => tagName.get(x)).join("; "),
          t.note,
        ]
          .map(cell)
          .join(",")
      ),
    ]
    return c.body(lines.join("\r\n") + "\r\n", 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${m.today}.csv"`,
      "Cache-Control": "no-store",
    })
  })
  /** Where a transaction sits in a filtered list, for previous and next. */
  api.get("/transactions/:id/neighbors", (c) => {
    const m = model.get()
    const tid = c.req.param("id")
    const items = list(m, c.req.query())
    const i = items.findIndex((t) => t.id === tid)
    return c.json({
      index: i,
      total: items.length,
      previous: i > 0 ? items[i - 1].id : null,
      // Without this one (just reviewed, say), the next is whatever follows
      // where it was.
      next:
        i >= 0
          ? (items[i + 1]?.id ?? null)
          : (items.find(
              (t) =>
                t.date < (m.txn.get(tid)?.date ?? "") ||
                (t.date === m.txn.get(tid)?.date && t.id > tid)
            )?.id ?? null),
    })
  })
  api.get("/transactions/:id", (c) => {
    const m = model.get()
    const t = m.txn.get(c.req.param("id"))
    if (!t) throw notFound("Transaction")
    const pair = t.transferPairId
      ? m.txns.find(
          (x) => x.transferPairId === t.transferPairId && x.id !== t.id
        )
      : undefined
    const sameMerchant = t.merchantKey
      ? m.txns.filter((x) => x.merchantKey === t.merchantKey && x.id !== t.id)
      : []
    const recurring = ctx.recurringOverrides().get(t.merchantKey)
    return c.json({
      ...txnJson(m, t),
      authorizedDate: t.authorizedDate,
      paymentChannel: t.paymentChannel,
      website: t.website,
      merchantKey: t.merchantKey,
      original: {
        date: t.snapshot.date,
        category: t.snapshot.category,
        merchant: t.snapshot.merchant,
        detailedCategory: t.detailedCategory,
      },
      overridden: t.override,
      splits: t.splits ?? [],
      ruleSplit: t.ruleSplit,
      rules: t.ruleIds.map((rid) => {
        const r = m.rules.find((x) => x.id === rid)!
        return { id: rid, match: r.match, action: r.action }
      }),
      pair: pair ? txnJson(m, pair) : null,
      similar: sameMerchant.slice(0, 5).map((x) => txnJson(m, x)),
      merchantCount: sameMerchant.length + 1,
      /** Same merchant, a different category: candidates for "apply to all". */
      merchantOtherCategory: sameMerchant.filter(
        (x) => x.categoryEff !== t.categoryEff && !x.splits?.length
      ).length,
      recurringStatus: recurring?.status ?? null,
    })
  })
  function patchTxn(
    m: Computed,
    txnId: string,
    input: z.infer<typeof TxnPatch>
  ) {
    let b = input
    const t = m.txn.get(txnId)
    if (!t) throw notFound("Transaction")
    if (b.category) validCategory(m, b.category)
    if (t.manual) {
      // A manual transaction's own row holds its category, merchant, date
      // and amount; the rest are ordinary edits.
      const cur = db
        .prepare("SELECT * FROM manual_txns WHERE id=?")
        .get(txnId) as Record<string, unknown>
      db.prepare(
        "UPDATE manual_txns SET category=?, merchant=?, date=?, amount_cents=? WHERE id=?"
      ).run(
        (b.category ?? cur.category) as string,
        b.merchant === undefined
          ? (cur.merchant as string | null)
          : (b.merchant ?? null),
        (b.date ?? cur.date) as string,
        (b.amountCents ?? cur.amount_cents) as number,
        txnId
      )
      b = { ...b, category: undefined, merchant: undefined, date: undefined }
    } else if (b.amountCents !== undefined)
      throw new HttpError(422, "Only manual transactions change amount")
    const cur = db
      .prepare("SELECT * FROM txn_overrides WHERE txn_id=?")
      .get(txnId) as Record<string, unknown> | undefined
    const pick = (key: keyof typeof b, column: string) =>
      b[key] === undefined
        ? (cur?.[column] ?? null)
        : b[key] === null
          ? null
          : typeof b[key] === "boolean"
            ? Number(b[key])
            : b[key]
    const row = {
      category: pick("category", "category"),
      merchant: pick("merchant", "merchant"),
      note: b.note === "" ? null : pick("note", "note"),
      hidden: pick("hidden", "hidden"),
      reviewed: pick("reviewed", "reviewed"),
      date: b.date === t.snapshot.date ? null : pick("date", "date"),
    }
    if (Object.values(row).every((v) => v == null))
      db.prepare("DELETE FROM txn_overrides WHERE txn_id=?").run(txnId)
    else
      db.prepare(
        `INSERT INTO txn_overrides(txn_id,category,merchant,note,hidden,reviewed,date,updated_at)
         VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(txn_id) DO UPDATE SET
         category=excluded.category, merchant=excluded.merchant, note=excluded.note,
         hidden=excluded.hidden, reviewed=excluded.reviewed, date=excluded.date,
         updated_at=excluded.updated_at`
      ).run(
        txnId,
        row.category as string | null,
        row.merchant as string | null,
        row.note as string | null,
        row.hidden as number | null,
        row.reviewed as number | null,
        row.date as string | null,
        now()
      )
    if (b.tags) {
      const known = new Set(m.tags.map((x) => x.id))
      db.prepare("DELETE FROM txn_tags WHERE txn_id=?").run(txnId)
      // Tags set by rules stay; only explicit additions are stored.
      for (const tag of new Set(b.tags))
        if (known.has(tag))
          db.prepare("INSERT OR IGNORE INTO txn_tags VALUES(?,?)").run(
            txnId,
            tag
          )
    }
  }
  api.patch("/transactions/:id", async (c) => {
    const b = await body(c, TxnPatch)
    const m = model.get()
    write(() => patchTxn(m, c.req.param("id"), b))
    return c.json(txnJson(model.get(), model.get().txn.get(c.req.param("id"))!))
  })
  api.post("/transactions", async (c) => {
    const b = await body(c, ManualTxn)
    const m = model.get()
    const account = m.account.get(b.accountId)
    if (!account?.manual)
      throw new HttpError(
        422,
        "Add transactions to a manual account; linked accounts sync their own"
      )
    validCategory(m, b.category)
    const txnId = id("mtxn")
    write(() => {
      db.prepare("INSERT INTO manual_txns VALUES(?,?,?,?,?,?,?)").run(
        txnId,
        b.accountId,
        b.date,
        b.amountCents,
        b.merchant ?? null,
        b.category,
        now()
      )
      // You entered it yourself, so it needs no review.
      db.prepare(
        "INSERT INTO txn_overrides(txn_id,note,reviewed,updated_at) VALUES(?,?,1,?)"
      ).run(txnId, b.note || null, now())
      const known = new Set(m.tags.map((x) => x.id))
      for (const tag of new Set(b.tags ?? []))
        if (known.has(tag))
          db.prepare("INSERT OR IGNORE INTO txn_tags VALUES(?,?)").run(
            txnId,
            tag
          )
    })
    return c.json({ id: txnId }, 201)
  })
  api.delete("/transactions/:id", (c) => {
    const t = model.get().txn.get(c.req.param("id"))
    if (!t) throw notFound("Transaction")
    if (!t.manual)
      throw new HttpError(
        422,
        "Only manual transactions can be deleted; hide others"
      )
    write(() => {
      for (const table of ["txn_overrides", "txn_splits", "txn_tags"])
        db.prepare(`DELETE FROM ${table} WHERE txn_id=?`).run(t.id)
      db.prepare("DELETE FROM manual_txns WHERE id=?").run(t.id)
    })
    return c.json({ ok: true })
  })
  /**
   * Edit many at once: listed ids, or every transaction matching the list's
   * filters (the same query the list uses).
   */
  api.post("/transactions/bulk", async (c) => {
    const b = await body(
      c,
      z
        .object({
          ids: z.array(z.string()).min(1).max(5000).optional(),
          filter: z.record(z.string(), z.string()).optional(),
          patch: BulkPatch.optional(),
          addTag: z.string().optional(),
          removeTag: z.string().optional(),
        })
        .strict()
        .refine((x) => Boolean(x.ids) !== Boolean(x.filter), {
          message: "Send ids or a filter",
        })
        .refine(
          (x) =>
            x.addTag ||
            x.removeTag ||
            (x.patch && Object.values(x.patch).some((v) => v !== undefined)),
          { message: "Choose a change to make" }
        )
    )
    const m = model.get()
    for (const tag of [b.addTag, b.removeTag])
      if (tag && !m.tags.some((t) => t.id === tag))
        throw new HttpError(422, "Choose an existing tag")
    const ids = b.ids ?? list(m, { ...b.filter, offset: "0" }).map((t) => t.id)
    if (ids.length > 5000)
      throw new HttpError(422, "Narrow the filter to 5,000 or fewer")
    write(() => {
      for (const txnId of ids) {
        if (b.patch) patchTxn(m, txnId, b.patch)
        if (b.addTag)
          db.prepare("INSERT OR IGNORE INTO txn_tags VALUES(?,?)").run(
            txnId,
            b.addTag
          )
        if (b.removeTag)
          db.prepare("DELETE FROM txn_tags WHERE txn_id=? AND tag_id=?").run(
            txnId,
            b.removeTag
          )
      }
    })
    // A tag a rule adds cannot be removed here; say how many kept it.
    const after = model.get()
    const kept = b.removeTag
      ? ids.filter((x) => after.txn.get(x)?.tags.includes(b.removeTag!)).length
      : 0
    return c.json({ updated: ids.length, keptByRules: kept })
  })
  api.put("/transactions/:id/splits", async (c) => {
    const b = await body(c, SplitsBody)
    const m = model.get()
    const t = m.txn.get(c.req.param("id"))
    if (!t) throw notFound("Transaction")
    if (b.splits.length === 1)
      throw new HttpError(422, "Split into at least two parts")
    if (b.splits.length) {
      const sum = b.splits.reduce((s, x) => s + x.amountCents, 0)
      if (sum !== t.amountCents)
        throw new HttpError(
          422,
          "Split amounts must add up to the transaction amount"
        )
      if (
        b.splits.some(
          (x) => Math.sign(x.amountCents) !== Math.sign(t.amountCents)
        )
      )
        throw new HttpError(
          422,
          "Every split must have the same sign as the transaction"
        )
      for (const s of b.splits) validCategory(m, s.category)
    }
    write(() => {
      db.prepare("DELETE FROM txn_splits WHERE txn_id=?").run(t.id)
      b.splits.forEach((s, i) =>
        db
          .prepare("INSERT INTO txn_splits VALUES(?,?,?,?,?)")
          .run(t.id, i, s.amountCents, s.category, s.note || null)
      )
    })
    return c.json({ ok: true })
  })
}
