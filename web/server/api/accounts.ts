import { Hono } from "hono"
import {
  accountSeries,
  addDays,
  addMonths,
  asRange,
  monthOf,
  monthlyFlows,
  monthsBetween,
  rangeStart,
  sampleDates,
} from "../analytics.ts"
import { z } from "zod"
import { earliestDate, isDate } from "../analytics.ts"
import { MANUAL_TYPES } from "../model.ts"
import {
  accountJson,
  body,
  HttpError,
  id,
  notFound,
  now,
  txnJson,
  type Ctx,
} from "./context.ts"

export function registerAccounts(api: Hono, ctx: Ctx) {
  const { model, db, write, settings } = ctx
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
    const history = m.balanceHistory.get(a.id) ?? []
    const from = rangeStart(range, m.today, history[0]?.date ?? m.today)
    const dates = sampleDates(from, m.today)
    const values = accountSeries(m, a, dates)
    const txns = m.txns.filter((t) => t.accountId === a.id)
    const flowMonths = monthsBetween(
      addMonths(monthOf(m.today), -5),
      monthOf(m.today)
    )
    // Transfers (card payments, savings moves) sit beside income and spending.
    const moved = new Map(
      flowMonths.map((mo) => [mo, { inCents: 0, outCents: 0 }])
    )
    for (const x of m.allocations) {
      if (x.txn.accountId !== a.id || x.txn.pending || x.group !== "transfer")
        continue
      const row = moved.get(monthOf(x.txn.date))
      if (!row) continue
      if (x.amountCents > 0) row.inCents += x.amountCents
      else row.outCents -= x.amountCents
    }
    const flows = monthlyFlows(
      m,
      flowMonths,
      (x) => x.txn.accountId === a.id
    ).map((f) => ({
      ...f,
      transferInCents: moved.get(f.month)!.inCents,
      transferOutCents: moved.get(f.month)!.outCents,
    }))
    return c.json({
      account: accountJson(a),
      range,
      series: dates.map((date, i) => ({ date, cents: values[i] })),
      estimated: history.some((h) => h.estimated),
      flows,
      transactions: txns.length,
      recent: txns
        .filter((t) => !t.hidden)
        .slice(0, 10)
        .map((t) => txnJson(m, t)),
      holdings: m.detail.holdings.filter((h) => h.accountId === a.id).length,
      /** Stated balances, newest first, for a manual account. */
      balances: a.manual
        ? (
            db
              .prepare(
                "SELECT date, cents FROM manual_balances WHERE account_id=? ORDER BY date DESC"
              )
              .all(a.id) as { date: string; cents: number }[]
          ).map((r) => ({ date: r.date, cents: r.cents }))
        : [],
      closedAt: a.closedAt,
      liability: m.detail.liabilities.find((l) => l.accountId === a.id) ?? null,
      source: m.detail.sources.find((x) => x.id === a.sourceId) ?? null,
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
          /** Manual accounts only. */
          type: z.enum(MANUAL_TYPES).optional(),
          closed: z.boolean().optional(),
        })
        .strict()
    )
    const m = model.get()
    const a = m.account.get(c.req.param("id"))
    if (!a) throw notFound("Account")
    if ((b.type || b.closed !== undefined) && !a.manual)
      throw new HttpError(422, "Only manual accounts change type or close")
    write(() => {
      if (a.manual) {
        if (b.displayName)
          db.prepare("UPDATE manual_accounts SET name=? WHERE id=?").run(
            b.displayName,
            a.id
          )
        if (b.type)
          db.prepare("UPDATE manual_accounts SET type=? WHERE id=?").run(
            b.type,
            a.id
          )
        if (b.closed !== undefined)
          db.prepare("UPDATE manual_accounts SET closed_at=? WHERE id=?").run(
            b.closed ? m.today : null,
            a.id
          )
      }
      db.prepare(
        `INSERT INTO account_overrides VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET
           display_name=excluded.display_name, hidden=excluded.hidden, exclude_net_worth=excluded.exclude_net_worth`
      ).run(
        a.id,
        // A manual account's name lives on its own row.
        a.manual
          ? null
          : b.displayName === undefined
            ? a.name === a.label
              ? null
              : a.name
            : b.displayName || null,
        Number(b.hidden ?? a.hidden),
        Number(b.excludeNetWorth ?? a.excludeNetWorth)
      )
    })
    return c.json({ ok: true })
  })

  /** Add an account kept by hand: a house, a car, cash, an account with no feed. */
  api.post("/accounts", async (c) => {
    const b = await body(
      c,
      z
        .object({
          name: z.string().trim().min(1).max(60),
          type: z.enum(MANUAL_TYPES),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          balanceCents: z.number().int().min(-1e13).max(1e13).optional(),
          date: z.string().refine(isDate, "Use a valid date").optional(),
        })
        .strict()
    )
    const m = model.get()
    const accountId = id("macct")
    write(() => {
      db.prepare(
        "INSERT INTO manual_accounts(id,name,type,currency,created_at) VALUES(?,?,?,?,?)"
      ).run(accountId, b.name, b.type, b.currency ?? "USD", now())
      if (b.balanceCents !== undefined)
        db.prepare("INSERT INTO manual_balances VALUES(?,?,?)").run(
          accountId,
          b.date ?? m.today,
          b.balanceCents
        )
    })
    return c.json({ id: accountId }, 201)
  })
  api.delete("/accounts/:id", (c) => {
    const a = model.get().account.get(c.req.param("id"))
    if (!a) throw notFound("Account")
    if (!a.manual)
      throw new HttpError(
        422,
        "Linked accounts are removed from the connection"
      )
    write(() => {
      const ids = (
        db
          .prepare("SELECT id FROM manual_txns WHERE account_id=?")
          .all(a.id) as { id: string }[]
      ).map((r) => r.id)
      for (const tid of ids)
        for (const table of ["txn_overrides", "txn_splits", "txn_tags"])
          db.prepare(`DELETE FROM ${table} WHERE txn_id=?`).run(tid)
      db.prepare("DELETE FROM manual_txns WHERE account_id=?").run(a.id)
      db.prepare("DELETE FROM manual_balances WHERE account_id=?").run(a.id)
      db.prepare("DELETE FROM goal_allocations WHERE account_id=?").run(a.id)
      db.prepare("DELETE FROM account_overrides WHERE account_id=?").run(a.id)
      db.prepare("DELETE FROM manual_accounts WHERE id=?").run(a.id)
    })
    return c.json({ ok: true })
  })
  /** Record a manual account's balance on a day (replacing that day's). */
  api.put("/accounts/:id/balances/:date", async (c) => {
    const b = await body(
      c,
      z.object({ cents: z.number().int().min(-1e13).max(1e13) }).strict()
    )
    const date = c.req.param("date")
    if (!isDate(date)) throw new HttpError(422, "Use a valid date")
    const a = model.get().account.get(c.req.param("id"))
    if (!a?.manual) throw notFound("Manual account")
    write(() =>
      db
        .prepare(
          "INSERT INTO manual_balances VALUES(?,?,?) ON CONFLICT(account_id,date) DO UPDATE SET cents=excluded.cents"
        )
        .run(a.id, date, b.cents)
    )
    return c.json({ ok: true })
  })
  api.delete("/accounts/:id/balances/:date", (c) => {
    const a = model.get().account.get(c.req.param("id"))
    if (!a?.manual) throw notFound("Manual account")
    write(() =>
      db
        .prepare("DELETE FROM manual_balances WHERE account_id=? AND date=?")
        .run(a.id, c.req.param("date"))
    )
    return c.json({ ok: true })
  })

  /** Net worth by kind of account over time, for a stacked chart. */
  api.get("/networth", (c) => {
    const m = model.get()
    const range = asRange(c.req.query("range"), settings().defaultRange)
    const from = rangeStart(range, m.today, earliestDate(m))
    const dates = sampleDates(from, m.today)
    const groups = new Map<string, number[]>(
      NET_WORTH_GROUPS.map((g) => [g, dates.map(() => 0)])
    )
    for (const a of m.accounts) {
      if (a.excludeNetWorth) continue
      const row = groups.get(netWorthGroup(a))!
      accountSeries(m, a, dates).forEach((v, i) => (row[i] += v ?? 0))
    }
    const used = NET_WORTH_GROUPS.filter((g) =>
      groups.get(g)!.some((v) => v !== 0)
    )
    return c.json({
      range,
      groups: used,
      series: dates.map((date, i) => {
        const row: Record<string, number | string> = { date }
        let net = 0
        for (const g of used) {
          row[g] = groups.get(g)![i]
          net += groups.get(g)![i]
        }
        row.net = net
        return row
      }),
      change: Object.fromEntries(
        used.map((g) => [g, groups.get(g)!.at(-1)! - groups.get(g)![0]])
      ),
    })
  })
}

const NET_WORTH_GROUPS = [
  "cash",
  "investments",
  "property",
  "other",
  "credit",
  "loans",
] as const
/** Which band of the net worth chart an account sits in. */
export function netWorthGroup(a: {
  type: string
  subtype: string | null
}): (typeof NET_WORTH_GROUPS)[number] {
  if (a.type === "depository") return "cash"
  if (a.type === "investment" || a.type === "brokerage") return "investments"
  if (a.type === "credit") return "credit"
  if (a.type === "loan") return "loans"
  if (a.subtype === "property" || a.subtype === "vehicle") return "property"
  return "other"
}
