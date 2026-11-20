import { randomBytes } from "node:crypto"
import { Hono, type Context } from "hono"
import { z } from "zod"
import {
  accountSeries,
  addDays,
  addMonths,
  asRange,
  cadenceDays,
  categoryTotals,
  detectRecurring,
  earliestDate,
  isDate,
  isMonth,
  monthEnd,
  monthOf,
  monthlyFlows,
  monthsBetween,
  netWorthSeries,
  rangeStart,
  sampleDates,
  spendCents,
} from "./analytics.ts"
import { DetailUnavailable } from "./detail.ts"
import type { AccountView, Computed, EffTxn, Model } from "./model.ts"
import { normalizeText } from "./normalize.ts"
import { applyRules, compileMatch, matchText, RuleAction, RuleMatch } from "./rules.ts"

const id = (prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`
const now = () => new Date().toISOString()

export class HttpError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 422,
    message: string
  ) {
    super(message)
  }
}
const notFound = (what: string) => new HttpError(404, `${what} not found`)

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new HttpError(400, "Send a JSON body")
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid request")
  return parsed.data
}

function accountJson(a: AccountView) {
  return {
    id: a.id,
    name: a.name,
    label: a.label,
    officialName: a.officialName,
    institution: a.institution,
    sourceId: a.sourceId,
    sourceStatus: a.sourceStatus,
    type: a.type,
    subtype: a.subtype,
    mask: a.mask,
    currency: a.currency,
    balanceCents: a.balanceCents,
    availableCents: a.availableCents,
    limitCents: a.limitCents,
    liability: a.liability,
    availability: a.availability,
    scope: a.scope,
    hidden: a.hidden,
    excludeNetWorth: a.excludeNetWorth,
  }
}

function txnJson(c: Computed, t: EffTxn) {
  const account = c.account.get(t.accountId)
  return {
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    currency: t.currency,
    merchant: t.merchantEff,
    description: t.description,
    category: t.categoryEff,
    accountId: t.accountId,
    accountName: account?.name ?? "Account",
    pending: t.pending,
    hidden: t.hidden,
    reviewed: t.reviewed,
    note: t.note,
    tags: t.tags,
    split: Boolean(t.splits?.length),
    flowKind: t.flowKind,
    transferPairId: t.transferPairId,
  }
}

const TxnPatch = z
  .object({
    category: z.string().min(1).max(100).nullable().optional(),
    merchant: z.string().trim().min(1).max(200).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    hidden: z.boolean().nullable().optional(),
    reviewed: z.boolean().nullable().optional(),
    tags: z.array(z.string().max(100)).max(20).optional(),
  })
  .strict()

const SplitsBody = z
  .object({
    splits: z
      .array(
        z.object({
          amountCents: z.number().int().refine((v) => v !== 0, "Split amounts cannot be zero"),
          category: z.string().min(1).max(100),
          note: z.string().trim().max(500).nullable().optional(),
        })
      )
      .max(20),
  })
  .strict()

const RuleBody = z
  .object({
    match: RuleMatch,
    action: RuleAction,
    enabled: z.boolean().optional(),
  })
  .strict()

const GoalBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["save", "payoff"]),
    targetCents: z.number().int().positive().max(1e13),
    targetDate: z.string().refine(isDate, "Use a valid date").nullable().optional(),
    accountIds: z.array(z.string().min(1)).min(1, "Choose at least one account").max(20),
  })
  .strict()

const CategoryBody = z
  .object({
    label: z.string().trim().min(1).max(60),
    parent: z.string().min(1).max(100),
  })
  .strict()

const SETTINGS = z
  .object({
    defaultRange: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]),
    weekStartsOn: z.enum(["sunday", "monday"]),
    showPending: z.boolean(),
    reviewNewTransactions: z.boolean(),
  })
  .strict()
type Settings = z.infer<typeof SETTINGS>
const DEFAULT_SETTINGS: Settings = {
  defaultRange: "6m",
  weekStartsOn: "monday",
  showPending: true,
  reviewNewTransactions: true,
}

/** JSON API mounted under /api on the Access-guarded shell server. */
export function createApi(model: Model) {
  const db = model.db
  const api = new Hono()
  const write = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE")
    try {
      const out = fn()
      db.exec("COMMIT")
      model.invalidate()
      return out
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
  const settings = (): Settings => {
    const stored = Object.fromEntries(
      (db.prepare("SELECT key, value_json FROM settings").all() as { key: string; value_json: string }[]).map(
        (r) => [r.key, JSON.parse(r.value_json)]
      )
    )
    const merged = SETTINGS.safeParse({ ...DEFAULT_SETTINGS, ...stored })
    return merged.success ? merged.data : DEFAULT_SETTINGS
  }
  const validCategory = (c: Computed, code: string) => {
    if (!c.categories.some((x) => x.code === code)) throw new HttpError(422, "Choose an existing category")
  }

  api.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status)
    if (error instanceof DetailUnavailable) return c.json({ error: error.message }, 503)
    throw error
  })

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
        accounts: m.accounts.filter((a) => a.sourceId === x.id).length,
      })),
      settings: settings(),
      unreviewed: m.txns.filter((t) => !t.reviewed && !t.hidden && !t.pending).length,
    })
  })

  api.get("/categories", (c) => {
    const m = model.get()
    const counts = new Map<string, number>()
    for (const t of m.txns) counts.set(t.categoryEff, (counts.get(t.categoryEff) ?? 0) + 1)
    return c.json(
      m.categories.map((x) => ({
        code: x.code,
        label: x.label,
        group: x.group,
        parent: x.parent,
        custom: x.custom,
        hidden: x.hidden,
        transactions: counts.get(x.code) ?? 0,
      }))
    )
  })
  api.post("/categories", async (c) => {
    const b = await body(c, CategoryBody)
    const m = model.get()
    const parent = m.categories.find((x) => x.code === b.parent && !x.custom)
    if (!parent) throw new HttpError(422, "Choose a built-in parent category")
    const code = id("cat")
    write(() =>
      db
        .prepare("INSERT INTO categories(code,label,grp,parent,hidden,sort) VALUES(?,?,?,?,0,?)")
        .run(code, b.label, parent.group, parent.code, parent.sort)
    )
    return c.json({ code }, 201)
  })
  api.patch("/categories/:code", async (c) => {
    const b = await body(
      c,
      z.object({ label: z.string().trim().min(1).max(60).optional(), hidden: z.boolean().optional() }).strict()
    )
    const m = model.get()
    const cat = m.categories.find((x) => x.code === c.req.param("code"))
    if (!cat) throw notFound("Category")
    write(() =>
      db
        .prepare(
          `INSERT INTO categories(code,label,grp,parent,hidden,sort) VALUES(?,?,?,?,?,?)
           ON CONFLICT(code) DO UPDATE SET label=excluded.label, hidden=excluded.hidden`
        )
        .run(cat.code, b.label ?? cat.label, cat.group, cat.parent, Number(b.hidden ?? cat.hidden), cat.sort)
    )
    return c.json({ ok: true })
  })
  api.delete("/categories/:code", (c) => {
    const m = model.get()
    const cat = m.categories.find((x) => x.code === c.req.param("code"))
    if (!cat?.custom) throw new HttpError(422, "Only custom categories can be deleted")
    const used =
      m.txns.some((t) => t.categoryEff === cat.code || t.splits?.some((s) => s.category === cat.code)) ||
      m.rules.some((r) => r.action.category === cat.code)
    if (used) throw new HttpError(409, "Move its transactions and rules to another category first")
    write(() => {
      db.prepare("DELETE FROM categories WHERE code=?").run(cat.code)
      db.prepare("DELETE FROM budgets WHERE category=?").run(cat.code)
      db.prepare("DELETE FROM budget_defaults WHERE category=?").run(cat.code)
    })
    return c.json({ ok: true })
  })

  api.get("/tags", (c) => {
    const m = model.get()
    const counts = new Map<string, number>()
    for (const t of m.txns) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return c.json(m.tags.map((t) => ({ ...t, transactions: counts.get(t.id) ?? 0 })))
  })
  const TagBody = z
    .object({
      name: z.string().trim().min(1).max(40),
      hue: z.enum(["re", "or", "ye", "gr", "cy", "bl", "pu", "ma"]).nullable().optional(),
    })
    .strict()
  api.post("/tags", async (c) => {
    const b = await body(c, TagBody)
    const tagId = id("tag")
    try {
      write(() => db.prepare("INSERT INTO tags VALUES(?,?,?)").run(tagId, b.name, b.hue ?? null))
    } catch {
      throw new HttpError(409, "A tag with that name already exists")
    }
    return c.json({ id: tagId }, 201)
  })
  api.patch("/tags/:id", async (c) => {
    const b = await body(c, TagBody.partial())
    const tag = model.get().tags.find((t) => t.id === c.req.param("id"))
    if (!tag) throw notFound("Tag")
    try {
      write(() =>
        db.prepare("UPDATE tags SET name=?, hue=? WHERE id=?").run(b.name ?? tag.name, b.hue === undefined ? tag.hue : b.hue, tag.id)
      )
    } catch {
      throw new HttpError(409, "A tag with that name already exists")
    }
    return c.json({ ok: true })
  })
  api.delete("/tags/:id", (c) => {
    const tagId = c.req.param("id")
    write(() => {
      db.prepare("DELETE FROM txn_tags WHERE tag_id=?").run(tagId)
      db.prepare("DELETE FROM tags WHERE id=?").run(tagId)
    })
    return c.json({ ok: true })
  })

  api.get("/summary", (c) => {
    const m = model.get()
    const range = asRange(c.req.query("range"), settings().defaultRange)
    const earliest = earliestDate(m)
    const from = rangeStart(range, m.today, earliest)
    const series = netWorthSeries(m, sampleDates(from, m.today))
    const month = monthOf(m.today)
    const prev = addMonths(month, -1)
    const [thisFlow, prevFlow] = monthlyFlows(m, [month, prev])
    // Cumulative daily spending, this month against last month.
    const day = Number(m.today.slice(8, 10))
    const daysInPrev = Number(monthEnd(prev).slice(8, 10))
    const cumulative = (mon: string, days: number) => {
      const perDay = Array.from({ length: days }, () => 0)
      for (const a of m.allocations)
        if (!a.txn.pending && a.group === "expense" && monthOf(a.txn.date) === mon)
          perDay[Number(a.txn.date.slice(8, 10)) - 1] += spendCents(a)
      let sum = 0
      return perDay.map((v) => (sum += v))
    }
    const thisCum = cumulative(month, day)
    const prevCum = cumulative(prev, daysInPrev)
    const pace = Array.from({ length: Math.max(daysInPrev, 31) }, (_, i) => ({
      day: i + 1,
      thisMonth: i < thisCum.length ? thisCum[i] : null,
      lastMonth: i < prevCum.length ? prevCum[i] : null,
    }))
    const top = [...categoryTotals(m, `${month}-01`, m.today)]
      .filter(([code]) => m.category(code).group === "expense")
      .map(([code, t]) => ({ code, label: m.category(code).label, cents: t.cents }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => b.cents - a.cents)
    const overrides = recurringOverrides()
    const upcoming = detectRecurring(m, overrides)
      .filter((r) => r.status === "active" && r.nextDate >= m.today && r.nextDate <= addDays(m.today, 31))
      .slice(0, 6)
      .map(({ history: _h, ...r }) => r)
    const latest = series.at(-1)
    const first = series[0]
    return c.json({
      range,
      netWorth: {
        cents: latest?.net ?? 0,
        assetsCents: latest?.assets ?? 0,
        liabilitiesCents: latest?.liabilities ?? 0,
        changeCents: latest && first ? latest.net - first.net : 0,
        series,
      },
      month: {
        month,
        incomeCents: thisFlow.incomeCents,
        spendingCents: thisFlow.spendingCents,
        lastMonthSpendingCents: prevFlow.spendingCents,
        lastMonthSameDayCents: prevCum[Math.min(day, prevCum.length) - 1] ?? 0,
        pace,
        top,
      },
      budget: budgetSummary(m, month),
      upcoming,
      accounts: m.accounts.filter((a) => !a.hidden && a.availability === "available").map(accountJson),
      recent: m.txns.filter((t) => !t.hidden).slice(0, 8).map((t) => txnJson(m, t)),
      unreviewed: m.txns.filter((t) => !t.reviewed && !t.hidden && !t.pending).length,
    })
  })

  api.get("/accounts", (c) => {
    const m = model.get()
    const dates = sampleDates(addDays(m.today, -90), m.today, 30)
    return c.json(
      m.accounts.map((a) => ({
        ...accountJson(a),
        spark: accountSeries(m, a, dates),
        changeCents: (() => {
          const s = accountSeries(m, a, [addDays(m.today, -30), m.today])
          return s[0] != null && s[1] != null ? s[1] - s[0] : null
        })(),
      }))
    )
  })
  api.get("/accounts/:id", (c) => {
    const m = model.get()
    const a = m.account.get(c.req.param("id"))
    if (!a) throw notFound("Account")
    const range = asRange(c.req.query("range"), settings().defaultRange)
    const history = m.detail.balanceHistory.get(a.id) ?? []
    const from = rangeStart(range, m.today, history[0]?.date ?? m.today)
    const dates = sampleDates(from, m.today)
    const values = accountSeries(m, a, dates)
    const txns = m.txns.filter((t) => t.accountId === a.id)
    const flows = monthlyFlows(
      m,
      monthsBetween(addMonths(monthOf(m.today), -5), monthOf(m.today)),
      (x) => x.txn.accountId === a.id
    )
    return c.json({
      account: accountJson(a),
      range,
      series: dates.map((date, i) => ({ date, cents: values[i] })),
      estimated: history.some((h) => h.estimated),
      flows,
      transactions: txns.length,
      recent: txns.filter((t) => !t.hidden).slice(0, 10).map((t) => txnJson(m, t)),
      holdings: m.detail.holdings.filter((h) => h.accountId === a.id).length,
    })
  })
  api.patch("/accounts/:id", async (c) => {
    const b = await body(
      c,
      z
        .object({
          displayName: z.string().trim().max(60).nullable().optional(),
          hidden: z.boolean().optional(),
          excludeNetWorth: z.boolean().optional(),
        })
        .strict()
    )
    const a = model.get().account.get(c.req.param("id"))
    if (!a) throw notFound("Account")
    write(() =>
      db
        .prepare(
          `INSERT INTO account_overrides VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET
           display_name=excluded.display_name, hidden=excluded.hidden, exclude_net_worth=excluded.exclude_net_worth`
        )
        .run(
          a.id,
          b.displayName === undefined ? (a.name === a.label ? null : a.name) : b.displayName || null,
          Number(b.hidden ?? a.hidden),
          Number(b.excludeNetWorth ?? a.excludeNetWorth)
        )
    )
    return c.json({ ok: true })
  })

  const TxnQuery = (c: Context) => {
    const q = c.req.query()
    return {
      q: (q.q ?? "").slice(0, 100),
      account: q.account,
      category: q.category,
      merchant: q.merchant,
      tag: q.tag,
      from: isDate(q.from) ? q.from : undefined,
      to: isDate(q.to) ? q.to : undefined,
      min: q.min && /^\d+$/.test(q.min) ? Number(q.min) : undefined,
      max: q.max && /^\d+$/.test(q.max) ? Number(q.max) : undefined,
      direction: q.direction === "in" || q.direction === "out" ? q.direction : undefined,
      status: ["unreviewed", "reviewed", "hidden", "pending", "split", "all"].includes(q.status) ? q.status : "visible",
      sort: ["date", "amount", "merchant"].includes(q.sort) ? q.sort : "date",
      order: q.order === "asc" ? "asc" : "desc",
      offset: Math.max(0, Number(q.offset) || 0),
      limit: Math.min(200, Math.max(1, Number(q.limit) || 50)),
    }
  }
  function filterTxns(m: Computed, f: ReturnType<typeof TxnQuery>) {
    const needle = normalizeText(f.q)
    const categoryCodes = f.category
      ? new Set(m.categories.filter((x) => x.code === f.category || x.parent === f.category).map((x) => x.code))
      : undefined
    return m.txns.filter((t) => {
      if (f.status === "visible" && t.hidden) return false
      if (f.status === "hidden" && !t.hidden) return false
      if (f.status === "unreviewed" && (t.reviewed || t.hidden || t.pending)) return false
      if (f.status === "reviewed" && !t.reviewed) return false
      if (f.status === "pending" && !t.pending) return false
      if (f.status === "split" && !t.splits?.length) return false
      if (f.account && t.accountId !== f.account) return false
      if (categoryCodes && !categoryCodes.has(t.categoryEff) && !t.splits?.some((s) => categoryCodes.has(s.category)))
        return false
      if (f.merchant && t.merchantKey !== f.merchant) return false
      if (f.tag && !t.tags.includes(f.tag)) return false
      if (f.from && t.date < f.from) return false
      if (f.to && t.date > f.to) return false
      if (f.direction === "in" && t.amountCents <= 0) return false
      if (f.direction === "out" && t.amountCents >= 0) return false
      const abs = Math.abs(t.amountCents)
      if (f.min !== undefined && abs < f.min) return false
      if (f.max !== undefined && abs > f.max) return false
      if (needle) {
        const hay = normalizeText(
          [t.merchantEff, t.description, t.note, m.category(t.categoryEff).label, m.account.get(t.accountId)?.name].join(" ")
        )
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }
  api.get("/transactions", (c) => {
    const m = model.get()
    const f = TxnQuery(c)
    let list = filterTxns(m, f)
    const dir = f.order === "asc" ? 1 : -1
    if (f.sort === "amount") list = list.toSorted((a, b) => (Math.abs(a.amountCents) - Math.abs(b.amountCents)) * dir)
    else if (f.sort === "merchant")
      list = list.toSorted((a, b) => (a.merchantEff ?? "").localeCompare(b.merchantEff ?? "") * dir)
    else if (f.order === "asc") list = list.toReversed()
    let inflow = 0
    let outflow = 0
    for (const t of list) if (t.amountCents > 0) inflow += t.amountCents
    else outflow += t.amountCents
    return c.json({
      total: list.length,
      inflowCents: inflow,
      outflowCents: outflow,
      offset: f.offset,
      items: list.slice(f.offset, f.offset + f.limit).map((t) => txnJson(m, t)),
    })
  })
  api.get("/transactions/:id", (c) => {
    const m = model.get()
    const t = m.txn.get(c.req.param("id"))
    if (!t) throw notFound("Transaction")
    const pair = t.transferPairId
      ? m.txns.find((x) => x.transferPairId === t.transferPairId && x.id !== t.id)
      : undefined
    return c.json({
      ...txnJson(m, t),
      authorizedDate: t.authorizedDate,
      paymentChannel: t.paymentChannel,
      website: t.website,
      merchantKey: t.merchantKey,
      original: { category: t.snapshot.category, merchant: t.snapshot.merchant, detailedCategory: t.detailedCategory },
      overridden: t.override,
      splits: t.splits ?? [],
      rules: t.ruleIds.map((rid) => {
        const r = m.rules.find((x) => x.id === rid)!
        return { id: rid, match: r.match, action: r.action }
      }),
      pair: pair ? txnJson(m, pair) : null,
      similar: m.txns
        .filter((x) => x.merchantKey === t.merchantKey && x.id !== t.id && t.merchantKey)
        .slice(0, 8)
        .map((x) => txnJson(m, x)),
    })
  })
  function patchTxn(m: Computed, txnId: string, b: z.infer<typeof TxnPatch>) {
    const t = m.txn.get(txnId)
    if (!t) throw notFound("Transaction")
    if (b.category) validCategory(m, b.category)
    const cur = db.prepare("SELECT * FROM txn_overrides WHERE txn_id=?").get(txnId) as Record<string, unknown> | undefined
    const pick = (key: keyof typeof b, column: string) =>
      b[key] === undefined ? (cur?.[column] ?? null) : b[key] === null ? null : typeof b[key] === "boolean" ? Number(b[key]) : b[key]
    const row = {
      category: pick("category", "category"),
      merchant: pick("merchant", "merchant"),
      note: b.note === "" ? null : pick("note", "note"),
      hidden: pick("hidden", "hidden"),
      reviewed: pick("reviewed", "reviewed"),
    }
    if (Object.values(row).every((v) => v == null)) db.prepare("DELETE FROM txn_overrides WHERE txn_id=?").run(txnId)
    else
      db.prepare(
        `INSERT INTO txn_overrides VALUES(?,?,?,?,?,?,?) ON CONFLICT(txn_id) DO UPDATE SET
         category=excluded.category, merchant=excluded.merchant, note=excluded.note,
         hidden=excluded.hidden, reviewed=excluded.reviewed, updated_at=excluded.updated_at`
      ).run(txnId, row.category as string | null, row.merchant as string | null, row.note as string | null, row.hidden as number | null, row.reviewed as number | null, now())
    if (b.tags) {
      const known = new Set(m.tags.map((x) => x.id))
      db.prepare("DELETE FROM txn_tags WHERE txn_id=?").run(txnId)
      // Tags set by rules stay; only explicit additions are stored.
      for (const tag of new Set(b.tags))
        if (known.has(tag)) db.prepare("INSERT OR IGNORE INTO txn_tags VALUES(?,?)").run(txnId, tag)
    }
  }
  api.patch("/transactions/:id", async (c) => {
    const b = await body(c, TxnPatch)
    const m = model.get()
    write(() => patchTxn(m, c.req.param("id"), b))
    return c.json(txnJson(model.get(), model.get().txn.get(c.req.param("id"))!))
  })
  api.post("/transactions/bulk", async (c) => {
    const b = await body(
      c,
      z
        .object({
          ids: z.array(z.string()).min(1).max(500),
          patch: TxnPatch.omit({ tags: true, note: true, merchant: true }),
          addTag: z.string().optional(),
        })
        .strict()
    )
    const m = model.get()
    if (b.addTag && !m.tags.some((t) => t.id === b.addTag)) throw new HttpError(422, "Choose an existing tag")
    write(() => {
      for (const txnId of b.ids) {
        patchTxn(m, txnId, b.patch)
        if (b.addTag) db.prepare("INSERT OR IGNORE INTO txn_tags VALUES(?,?)").run(txnId, b.addTag)
      }
    })
    return c.json({ updated: b.ids.length })
  })
  api.put("/transactions/:id/splits", async (c) => {
    const b = await body(c, SplitsBody)
    const m = model.get()
    const t = m.txn.get(c.req.param("id"))
    if (!t) throw notFound("Transaction")
    if (b.splits.length === 1) throw new HttpError(422, "Split into at least two parts")
    if (b.splits.length) {
      const sum = b.splits.reduce((s, x) => s + x.amountCents, 0)
      if (sum !== t.amountCents) throw new HttpError(422, "Split amounts must add up to the transaction amount")
      if (b.splits.some((x) => Math.sign(x.amountCents) !== Math.sign(t.amountCents)))
        throw new HttpError(422, "Every split must have the same sign as the transaction")
      for (const s of b.splits) validCategory(m, s.category)
    }
    write(() => {
      db.prepare("DELETE FROM txn_splits WHERE txn_id=?").run(t.id)
      b.splits.forEach((s, i) =>
        db.prepare("INSERT INTO txn_splits VALUES(?,?,?,?,?)").run(t.id, i, s.amountCents, s.category, s.note || null)
      )
    })
    return c.json({ ok: true })
  })

  api.get("/rules", (c) => {
    const m = model.get()
    const tests = m.rules.map((r) => ({ rule: r, test: compileMatch(r.match) }))
    const counts = new Map<string, number>()
    for (const t of m.txns) {
      const text = matchText(t)
      for (const { rule, test } of tests) if (test(t, text)) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1)
    }
    return c.json(m.rules.map((r) => ({ ...r, matches: counts.get(r.id) ?? 0 })))
  })
  api.get("/rules/:id", (c) => {
    const r = model.get().rules.find((x) => x.id === c.req.param("id"))
    if (!r) throw notFound("Rule")
    return c.json(r)
  })
  api.post("/rules/preview", async (c) => {
    const b = await body(c, z.object({ match: RuleMatch, action: RuleAction.optional(), ruleId: z.string().optional() }).strict())
    const m = model.get()
    const test = compileMatch(b.match)
    const matched = m.txns.filter((t) => test(t, matchText(t)))
    // Would this rule actually decide each field, given the rules ahead of it?
    const ahead = m.rules.filter((r) => r.enabled && r.id !== b.ruleId)
    let changes = 0
    if (b.action?.category) {
      const ordered = ahead.map((rule) => ({ rule, test: compileMatch(rule.match) }))
      for (const t of matched) {
        const before = applyRules(ordered, t)
        if (!before.category && t.categoryEff !== b.action.category) changes++
      }
    }
    return c.json({
      total: matched.length,
      changes,
      items: matched.slice(0, 25).map((t) => txnJson(m, t)),
    })
  })
  api.post("/rules", async (c) => {
    const b = await body(c, RuleBody)
    const m = model.get()
    if (b.action.category) validCategory(m, b.action.category)
    const ruleId = id("rule")
    write(() => {
      const max = (db.prepare("SELECT COALESCE(MAX(position), -1) AS p FROM rules").get() as { p: number }).p
      db.prepare("INSERT INTO rules VALUES(?,?,?,?,?,?)").run(
        ruleId,
        max + 1,
        Number(b.enabled ?? true),
        JSON.stringify(b.match),
        JSON.stringify(b.action),
        now()
      )
    })
    return c.json({ id: ruleId }, 201)
  })
  api.patch("/rules/:id", async (c) => {
    const b = await body(c, RuleBody.partial())
    const m = model.get()
    const r = m.rules.find((x) => x.id === c.req.param("id"))
    if (!r) throw notFound("Rule")
    if (b.action?.category) validCategory(m, b.action.category)
    write(() =>
      db
        .prepare("UPDATE rules SET match_json=?, action_json=?, enabled=? WHERE id=?")
        .run(JSON.stringify(b.match ?? r.match), JSON.stringify(b.action ?? r.action), Number(b.enabled ?? r.enabled), r.id)
    )
    return c.json({ ok: true })
  })
  api.delete("/rules/:id", (c) => {
    write(() => db.prepare("DELETE FROM rules WHERE id=?").run(c.req.param("id")))
    return c.json({ ok: true })
  })
  api.post("/rules/order", async (c) => {
    const b = await body(c, z.object({ ids: z.array(z.string()).max(1000) }).strict())
    const known = new Set(model.get().rules.map((r) => r.id))
    if (b.ids.length !== known.size || b.ids.some((x) => !known.has(x)))
      throw new HttpError(409, "Rules changed; reload and try again")
    write(() => b.ids.forEach((ruleId, i) => db.prepare("UPDATE rules SET position=? WHERE id=?").run(i, ruleId)))
    return c.json({ ok: true })
  })

  api.get("/cashflow", (c) => {
    const m = model.get()
    const count = Math.min(36, Math.max(3, Number(c.req.query("months")) || 12))
    const end = monthOf(m.today)
    const months = monthsBetween(addMonths(end, -(count - 1)), end)
    const flows = monthlyFlows(m, months)
    const selected = isMonth(c.req.query("month")) ? c.req.query("month")! : end
    const from = `${selected}-01`
    const to = monthEnd(selected)
    const totals = categoryTotals(m, from, to, "category")
    const rows = [...totals].map(([code, t]) => ({
      code,
      label: m.category(code).label,
      group: m.category(code).group,
      parent: m.category(code).parent,
      cents: t.cents,
      count: t.count,
    }))
    return c.json({
      months: flows,
      selected,
      income: rows.filter((r) => r.group === "income").sort((a, b) => b.cents - a.cents),
      spending: rows.filter((r) => r.group === "expense").sort((a, b) => b.cents - a.cents),
    })
  })

  api.get("/reports/categories", (c) => {
    const m = model.get()
    const range = asRange(c.req.query("range"), "6m")
    const from = rangeStart(range, m.today, earliestDate(m))
    const months = monthsBetween(monthOf(from), monthOf(m.today))
    const flows = monthlyFlows(m, months)
    const totals = categoryTotals(m, from, m.today, "category")
    const prevFrom = addDays(from, -(Date.parse(m.today) - Date.parse(from)) / 86_400_000)
    const prev = categoryTotals(m, prevFrom, addDays(from, -1), "category")
    const rows = [...totals]
      .filter(([code]) => m.category(code).group === "expense")
      .map(([code, t]) => ({
        code,
        label: m.category(code).label,
        parent: m.category(code).parent,
        cents: t.cents,
        count: t.count,
        previousCents: prev.get(code)?.cents ?? 0,
        monthly: flows.map((f) =>
          m.category(code).custom ? null : (f.byCategory[code] ?? 0)
        ),
      }))
      .sort((a, b) => b.cents - a.cents)
    return c.json({ range, from, to: m.today, months, rows, totalCents: rows.reduce((s, r) => s + r.cents, 0) })
  })
  api.get("/reports/categories/:code", (c) => {
    const m = model.get()
    const cat = m.categories.find((x) => x.code === c.req.param("code"))
    if (!cat) throw notFound("Category")
    const count = 12
    const end = monthOf(m.today)
    const months = monthsBetween(addMonths(end, -(count - 1)), end)
    const codes = new Set(m.categories.filter((x) => x.code === cat.code || x.parent === cat.code).map((x) => x.code))
    const monthly = months.map((month) => ({ month, cents: 0 }))
    const index = new Map(months.map((mo, i) => [mo, i]))
    const merchants = new Map<string, { name: string; cents: number; count: number }>()
    const sign = cat.group === "income" ? 1 : -1
    for (const a of m.allocations) {
      if (!codes.has(a.category) || a.txn.pending) continue
      const i = index.get(monthOf(a.txn.date))
      if (i === undefined) continue
      monthly[i].cents += sign * a.amountCents
      const key = a.txn.merchantKey || "unknown"
      const row = merchants.get(key) ?? { name: a.txn.merchantEff ?? "Unknown merchant", cents: 0, count: 0 }
      row.cents += sign * a.amountCents
      row.count++
      merchants.set(key, row)
    }
    const full = monthly.slice(0, -1)
    return c.json({
      category: { code: cat.code, label: cat.label, group: cat.group, parent: cat.parent, custom: cat.custom },
      monthly,
      averageCents: full.length ? Math.round(full.reduce((s, x) => s + x.cents, 0) / full.length) : 0,
      totalCents: monthly.reduce((s, x) => s + x.cents, 0),
      merchants: [...merchants].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.cents - a.cents).slice(0, 25),
      children: m.categories.filter((x) => x.parent === cat.code).map((x) => ({ code: x.code, label: x.label })),
    })
  })
  api.get("/reports/merchants", (c) => {
    const m = model.get()
    const range = asRange(c.req.query("range"), "6m")
    const from = rangeStart(range, m.today, earliestDate(m))
    const rows = new Map<string, { key: string; name: string; cents: number; count: number; last: string; category: string }>()
    for (const t of m.txns) {
      if (t.hidden || t.pending || t.amountCents >= 0 || t.date < from || !t.merchantKey) continue
      if (m.category(t.categoryEff).group !== "expense") continue
      const r = rows.get(t.merchantKey) ?? { key: t.merchantKey, name: t.merchantEff ?? t.merchantKey, cents: 0, count: 0, last: t.date, category: t.categoryEff }
      r.cents -= t.amountCents
      r.count++
      rows.set(t.merchantKey, r)
    }
    const list = [...rows.values()].sort((a, b) => b.cents - a.cents)
    return c.json({ range, from, rows: list.map((r) => ({ ...r, categoryLabel: m.category(r.category).label, averageCents: Math.round(r.cents / r.count) })) })
  })
  api.get("/reports/merchants/:key", (c) => {
    const m = model.get()
    const key = c.req.param("key")
    const txns = m.txns.filter((t) => t.merchantKey === key && !t.hidden)
    if (!txns.length) throw notFound("Merchant")
    const end = monthOf(m.today)
    const months = monthsBetween(addMonths(end, -11), end)
    const index = new Map(months.map((mo, i) => [mo, i]))
    const monthly = months.map((month) => ({ month, cents: 0, count: 0 }))
    for (const t of txns) {
      const i = index.get(monthOf(t.date))
      if (i === undefined || t.pending) continue
      monthly[i].cents -= t.amountCents
      monthly[i].count++
    }
    const spend = txns.filter((t) => !t.pending).reduce((s, t) => s - t.amountCents, 0)
    const recurring = detectRecurring(m, recurringOverrides()).find((r) => r.key === key)
    return c.json({
      key,
      name: txns[0].merchantEff ?? key,
      category: txns[0].categoryEff,
      categoryLabel: m.category(txns[0].categoryEff).label,
      totalCents: spend,
      count: txns.length,
      first: txns.at(-1)!.date,
      last: txns[0].date,
      monthly,
      recurring: recurring ? { cadence: recurring.cadence, amountCents: recurring.amountCents, nextDate: recurring.nextDate, status: recurring.status } : null,
      transactions: txns.slice(0, 50).map((t) => txnJson(m, t)),
    })
  })
  api.get("/reports/trends", (c) => {
    const m = model.get()
    const count = Math.min(36, Math.max(3, Number(c.req.query("months")) || 12))
    const end = monthOf(m.today)
    const months = monthsBetween(addMonths(end, -(count - 1)), end)
    const flows = monthlyFlows(m, months)
    const totals = new Map<string, number>()
    for (const f of flows) for (const [k, v] of Object.entries(f.byCategory)) totals.set(k, (totals.get(k) ?? 0) + v)
    const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k)
    return c.json({
      months,
      categories: top.map((code) => ({ code, label: m.category(code).label })),
      rows: flows.map((f) => {
        const row: Record<string, number | string> = { month: f.month, incomeCents: f.incomeCents, spendingCents: f.spendingCents, netCents: f.netCents }
        let rest = f.spendingCents
        for (const code of top) {
          row[code] = f.byCategory[code] ?? 0
          rest -= f.byCategory[code] ?? 0
        }
        row.other = rest
        row.savingsRate = f.incomeCents > 0 ? f.netCents / f.incomeCents : 0
        return row
      }),
    })
  })

  function budgetSummary(m: Computed, month: string) {
    const b = budgetRows(m, month)
    const budgeted = b.rows.filter((r) => r.budgetCents != null)
    return {
      month,
      budgetedCents: budgeted.reduce((s, r) => s + (r.budgetCents ?? 0), 0),
      spentCents: budgeted.reduce((s, r) => s + r.spentCents, 0),
      over: budgeted.filter((r) => r.spentCents > (r.budgetCents ?? 0)).length,
      rows: budgeted.sort((a, b) => b.spentCents / (b.budgetCents || 1) - a.spentCents / (a.budgetCents || 1)).slice(0, 5),
    }
  }
  function budgetRows(m: Computed, month: string) {
    const amounts = new Map(
      (db.prepare("SELECT category, amount_cents FROM budgets WHERE month=?").all(month) as { category: string; amount_cents: number }[]).map(
        (r) => [r.category, r.amount_cents]
      )
    )
    const defaults = new Map(
      (db.prepare("SELECT category, amount_cents FROM budget_defaults").all() as { category: string; amount_cents: number }[]).map(
        (r) => [r.category, r.amount_cents]
      )
    )
    const expense = m.categories.filter((x) => x.group === "expense" && !x.hidden)
    const budgetOf = (code: string) => amounts.get(code) ?? defaults.get(code)
    // Custom categories without their own budget roll into their parent.
    const target = (code: string) => {
      const cat = m.category(code)
      return cat.custom && budgetOf(code) == null ? cat.owned : code
    }
    const spent = (from: string, to: string) => {
      const out = new Map<string, number>()
      for (const a of m.allocations) {
        if (a.group !== "expense" || a.txn.pending || a.txn.date < from || a.txn.date > to) continue
        const key = target(a.category)
        out.set(key, (out.get(key) ?? 0) + spendCents(a))
      }
      return out
    }
    const now = spent(`${month}-01`, monthEnd(month))
    const last3 = spent(`${addMonths(month, -3)}-01`, monthEnd(addMonths(month, -1)))
    const last = spent(`${addMonths(month, -1)}-01`, monthEnd(addMonths(month, -1)))
    const income = monthlyFlows(m, [month])[0].incomeCents
    return {
      incomeCents: income,
      rows: expense.map((x) => ({
        code: x.code,
        label: x.label,
        parent: x.parent,
        custom: x.custom,
        budgetCents: budgetOf(x.code) ?? null,
        source: amounts.has(x.code) ? "month" : defaults.has(x.code) ? "default" : null,
        defaultCents: defaults.get(x.code) ?? null,
        spentCents: now.get(x.code) ?? 0,
        lastMonthCents: last.get(x.code) ?? 0,
        averageCents: Math.round((last3.get(x.code) ?? 0) / 3),
      })),
    }
  }
  api.get("/budgets", (c) => {
    const m = model.get()
    const month = isMonth(c.req.query("month")) ? c.req.query("month")! : monthOf(m.today)
    const { rows, incomeCents } = budgetRows(m, month)
    const day = month === monthOf(m.today) ? Number(m.today.slice(8, 10)) : month < monthOf(m.today) ? Number(monthEnd(month).slice(8, 10)) : 0
    return c.json({
      month,
      current: monthOf(m.today),
      elapsed: day / Number(monthEnd(month).slice(8, 10)),
      incomeCents,
      rows,
    })
  })
  api.put("/budgets/:month/:category", async (c) => {
    const month = c.req.param("month")
    if (!isMonth(month)) throw new HttpError(422, "Use a YYYY-MM month")
    const b = await body(c, z.object({ amountCents: z.number().int().min(0).max(1e12).nullable(), asDefault: z.boolean().optional() }).strict())
    const m = model.get()
    const code = c.req.param("category")
    const cat = m.categories.find((x) => x.code === code && x.group === "expense")
    if (!cat) throw notFound("Category")
    write(() => {
      if (b.amountCents == null) {
        db.prepare("DELETE FROM budgets WHERE month=? AND category=?").run(month, code)
        if (b.asDefault) db.prepare("DELETE FROM budget_defaults WHERE category=?").run(code)
      } else if (b.asDefault) {
        db.prepare("INSERT INTO budget_defaults VALUES(?,?) ON CONFLICT(category) DO UPDATE SET amount_cents=excluded.amount_cents").run(code, b.amountCents)
        db.prepare("DELETE FROM budgets WHERE month=? AND category=?").run(month, code)
      } else
        db.prepare("INSERT INTO budgets VALUES(?,?,?) ON CONFLICT(month,category) DO UPDATE SET amount_cents=excluded.amount_cents").run(month, code, b.amountCents)
    })
    return c.json({ ok: true })
  })
  api.post("/budgets/:month/copy-previous", (c) => {
    const month = c.req.param("month")
    if (!isMonth(month)) throw new HttpError(422, "Use a YYYY-MM month")
    const prev = addMonths(month, -1)
    let copied = 0
    write(() => {
      const rows = db.prepare("SELECT category, amount_cents FROM budgets WHERE month=?").all(prev) as { category: string; amount_cents: number }[]
      for (const r of rows) {
        db.prepare("INSERT OR IGNORE INTO budgets VALUES(?,?,?)").run(month, r.category, r.amount_cents)
        copied++
      }
    })
    return c.json({ copied })
  })

  function recurringOverrides() {
    return new Map(
      (db.prepare("SELECT * FROM recurring_overrides").all() as { merchant_key: string; status: string; cadence: string | null; expected_cents: number | null }[]).map(
        (r) => [r.merchant_key, r]
      )
    )
  }
  api.get("/recurring", (c) => {
    const m = model.get()
    const items = detectRecurring(m, recurringOverrides())
    const active = items.filter((i) => i.status === "active")
    const monthly = (i: (typeof items)[number]) => (i.amountCents * 30.44) / cadenceDays(i.cadence)
    return c.json({
      today: m.today,
      monthlyExpenseCents: Math.round(-active.filter((i) => i.kind === "expense").reduce((s, i) => s + monthly(i), 0)),
      monthlyIncomeCents: Math.round(active.filter((i) => i.kind === "income").reduce((s, i) => s + monthly(i), 0)),
      items: items.map((i) => ({ ...i, categoryLabel: m.category(i.category).label, accountName: m.account.get(i.accountId)?.name ?? "Account" })),
    })
  })
  api.patch("/recurring/:key", async (c) => {
    const b = await body(
      c,
      z
        .object({
          status: z.enum(["active", "ignored", "cancelled"]).optional(),
          cadence: z.enum(["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "yearly"]).nullable().optional(),
          expectedCents: z.number().int().nullable().optional(),
        })
        .strict()
    )
    const key = normalizeText(c.req.param("key"))
    const cur = recurringOverrides().get(key)
    write(() =>
      db
        .prepare(
          `INSERT INTO recurring_overrides VALUES(?,?,?,?) ON CONFLICT(merchant_key) DO UPDATE SET
           status=excluded.status, cadence=excluded.cadence, expected_cents=excluded.expected_cents`
        )
        .run(
          key,
          b.status ?? cur?.status ?? "active",
          b.cadence === undefined ? (cur?.cadence ?? null) : b.cadence,
          b.expectedCents === undefined ? (cur?.expected_cents ?? null) : b.expectedCents
        )
    )
    return c.json({ ok: true })
  })

  api.get("/investments", (c) => {
    const m = model.get()
    const range = asRange(c.req.query("range"), "1y")
    const holdings = m.detail.holdings.map((h) => ({
      ...h,
      accountName: m.account.get(h.accountId)?.name ?? "Account",
      gainCents: h.costBasisCents == null ? null : h.valueCents - h.costBasisCents,
    }))
    const total = holdings.reduce((s, h) => s + h.valueCents, 0)
    const basis = holdings.filter((h) => h.costBasisCents != null)
    const byType = new Map<string, number>()
    for (const h of holdings) byType.set(h.type, (byType.get(h.type) ?? 0) + h.valueCents)
    const history = m.detail.holdingHistory
    const earliest = history[0]?.date ?? m.today
    const from = rangeStart(range, m.today, earliest)
    const byDate = new Map<string, number>()
    // Latest value per security on each date, summed.
    const dates = sampleDates(from, m.today)
    const perSecurity = new Map<string, { date: string; v: number }[]>()
    for (const h of history) {
      const k = `${h.accountId}|${h.securityId}`
      let l = perSecurity.get(k)
      if (!l) perSecurity.set(k, (l = []))
      l.push({ date: h.date, v: h.valueCents })
    }
    for (const list of perSecurity.values()) {
      let i = 0
      let last: number | null = null
      for (const d of dates) {
        while (i < list.length && list[i].date <= d) last = list[i++].v
        if (last != null) byDate.set(d, (byDate.get(d) ?? 0) + last)
      }
    }
    const accounts = m.accounts.filter((a) => a.type === "investment" || holdings.some((h) => h.accountId === a.id))
    return c.json({
      range,
      totalCents: total,
      costBasisCents: basis.reduce((s, h) => s + (h.costBasisCents ?? 0), 0),
      gainCents: basis.reduce((s, h) => s + (h.gainCents ?? 0), 0),
      allocation: [...byType].map(([type, cents]) => ({ type, cents })).sort((a, b) => b.cents - a.cents),
      series: dates.filter((d) => byDate.has(d)).map((date) => ({ date, cents: byDate.get(date)! })),
      accounts: accounts.map((a) => ({ ...accountJson(a), holdingsCents: holdings.filter((h) => h.accountId === a.id).reduce((s, h) => s + h.valueCents, 0) })),
      holdings: holdings.sort((a, b) => b.valueCents - a.valueCents),
    })
  })

  function goalJson(m: Computed, g: { id: string; name: string; kind: string; target_cents: number; target_date: string | null; account_ids_json: string; created_at: string }) {
    const ids = (JSON.parse(g.account_ids_json) as string[]).filter((x) => m.account.has(x))
    const accounts = ids.map((x) => m.account.get(x)!)
    const balance = accounts.reduce((s, a) => s + (a.balanceCents ?? 0), 0)
    const current = g.kind === "payoff" ? Math.max(0, -balance) : balance
    const progress = g.kind === "payoff" ? Math.min(1, Math.max(0, (g.target_cents - current) / g.target_cents)) : Math.min(1, Math.max(0, current / g.target_cents))
    const dates = sampleDates(addDays(m.today, -365), m.today, 52)
    const series = dates.map(() => 0)
    for (const a of accounts) accountSeries(m, a, dates).forEach((v, i) => (series[i] += v ?? 0))
    const values = series.map((v) => (g.kind === "payoff" ? Math.max(0, -v) : v))
    // Average monthly change over the last 90 days projects a finish date.
    const back = accounts.length ? values[Math.max(0, values.length - 14)] : current
    const perMonth = ((current - back) / 90) * 30.44
    const remaining = g.kind === "payoff" ? current : g.target_cents - current
    const towards = g.kind === "payoff" ? -perMonth : perMonth
    const projected = remaining <= 0 ? m.today : towards > 0 ? addDays(m.today, Math.ceil((remaining / towards) * 30.44)) : null
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      targetCents: g.target_cents,
      targetDate: g.target_date,
      accountIds: ids,
      accountNames: accounts.map((a) => a.name),
      currentCents: current,
      progress,
      monthlyChangeCents: Math.round(perMonth),
      projectedDate: projected,
      onTrack: g.target_date && projected ? projected <= g.target_date : null,
      series: dates.map((date, i) => ({ date, cents: values[i] })),
      createdAt: g.created_at,
    }
  }
  const goals = () => db.prepare("SELECT * FROM goals ORDER BY created_at").all() as Parameters<typeof goalJson>[1][]
  api.get("/goals", (c) => {
    const m = model.get()
    return c.json(goals().map((g) => goalJson(m, g)))
  })
  api.get("/goals/:id", (c) => {
    const g = goals().find((x) => x.id === c.req.param("id"))
    if (!g) throw notFound("Goal")
    return c.json(goalJson(model.get(), g))
  })
  const checkGoalAccounts = (m: Computed, b: z.infer<typeof GoalBody>) => {
    for (const a of b.accountIds) {
      const acct = m.account.get(a)
      if (!acct) throw new HttpError(422, "Choose existing accounts")
      if (b.kind === "payoff" && !acct.liability) throw new HttpError(422, "Payoff goals track credit or loan accounts")
      if (b.kind === "save" && acct.liability) throw new HttpError(422, "Savings goals track cash or investment accounts")
    }
  }
  api.post("/goals", async (c) => {
    const b = await body(c, GoalBody)
    checkGoalAccounts(model.get(), b)
    const goalId = id("goal")
    write(() =>
      db.prepare("INSERT INTO goals VALUES(?,?,?,?,?,?,?)").run(goalId, b.name, b.kind, b.targetCents, b.targetDate ?? null, JSON.stringify(b.accountIds), now())
    )
    return c.json({ id: goalId }, 201)
  })
  api.put("/goals/:id", async (c) => {
    const b = await body(c, GoalBody)
    checkGoalAccounts(model.get(), b)
    const g = goals().find((x) => x.id === c.req.param("id"))
    if (!g) throw notFound("Goal")
    write(() =>
      db
        .prepare("UPDATE goals SET name=?, kind=?, target_cents=?, target_date=?, account_ids_json=? WHERE id=?")
        .run(b.name, b.kind, b.targetCents, b.targetDate ?? null, JSON.stringify(b.accountIds), g.id)
    )
    return c.json({ ok: true })
  })
  api.delete("/goals/:id", (c) => {
    write(() => db.prepare("DELETE FROM goals WHERE id=?").run(c.req.param("id")))
    return c.json({ ok: true })
  })

  api.get("/settings", (c) => c.json(settings()))
  api.patch("/settings", async (c) => {
    const b = await body(c, SETTINGS.partial())
    write(() => {
      for (const [key, value] of Object.entries(b))
        db.prepare("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(key, JSON.stringify(value))
    })
    return c.json(settings())
  })

  api.get("/search", (c) => {
    const m = model.get()
    const needle = normalizeText(c.req.query("q") ?? "")
    if (!needle) return c.json({ accounts: [], merchants: [], categories: [] })
    const merchants = new Map<string, { key: string; name: string; count: number }>()
    for (const t of m.txns) {
      if (!t.merchantKey || !t.merchantKey.includes(needle)) continue
      const r = merchants.get(t.merchantKey) ?? { key: t.merchantKey, name: t.merchantEff ?? t.merchantKey, count: 0 }
      r.count++
      merchants.set(t.merchantKey, r)
    }
    return c.json({
      accounts: m.accounts.filter((a) => normalizeText(`${a.name} ${a.institution}`).includes(needle)).slice(0, 6).map((a) => ({ id: a.id, name: a.name, institution: a.institution })),
      merchants: [...merchants.values()].sort((a, b) => b.count - a.count).slice(0, 8),
      categories: m.categories.filter((x) => normalizeText(x.label).includes(needle)).slice(0, 6).map((x) => ({ code: x.code, label: x.label })),
    })
  })

  return api
}
