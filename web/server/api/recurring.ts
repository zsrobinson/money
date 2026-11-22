import { Hono } from "hono"
import { z } from "zod"
import {
  addDays,
  cadenceDays,
  detectRecurring,
  fromDate,
  isMonth,
  monthEnd,
  monthOf,
  nextOccurrence,
  occurrences,
  type RecurringItem,
} from "../analytics.ts"
import type { Computed } from "../model.ts"
import { normalizeText } from "../normalize.ts"
import { body, notFound, txnJson, type Ctx } from "./context.ts"

const CADENCE = z.enum([
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "quarterly",
  "yearly",
])

/**
 * Each expected charge in a window with whether it was paid: a charge from
 * the same merchant within a few days counts. Unpaid ones are due, or
 * missed once a few days have passed.
 */
function schedule(
  item: RecurringItem,
  from: string,
  to: string,
  today: string
) {
  const slack = Math.max(
    2,
    Math.min(7, Math.floor(cadenceDays(item.cadence) / 4))
  )
  const used = new Set<string>()
  return occurrences(
    item.history.at(-1)?.date ?? item.lastDate,
    item.cadence,
    from,
    to
  ).map((date) => {
    const paid = item.history.find(
      (h) =>
        !used.has(h.id) &&
        Math.abs(fromDate(h.date) - fromDate(date)) <= slack * 86_400_000
    )
    if (paid) used.add(paid.id)
    return {
      date,
      state: paid
        ? ("paid" as const)
        : date < addDays(today, -slack)
          ? ("missed" as const)
          : ("due" as const),
      amountCents: paid?.amountCents ?? item.amountCents,
      txnId: paid?.id ?? null,
    }
  })
}

/** Card statements from the bank, when the card's details are synced. */
function cardBills(m: Computed) {
  return m.detail.liabilities
    .filter((l) => l.nextPaymentDueDate && m.account.has(l.accountId))
    .map((l) => {
      const a = m.account.get(l.accountId)!
      return {
        accountId: l.accountId,
        accountName: a.name,
        kind: l.kind,
        dueDate: l.nextPaymentDueDate!,
        statementCents: l.lastStatementBalanceCents,
        minimumCents: l.minimumPaymentCents,
        lastPaymentCents: l.lastPaymentCents,
        lastPaymentDate: l.lastPaymentDate,
        overdue: l.isOverdue,
        // Paid once a payment lands on or after the statement date.
        paid: Boolean(
          l.lastPaymentDate &&
          l.lastStatementDate &&
          l.lastPaymentDate >= l.lastStatementDate
        ),
      }
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
}

export function registerRecurring(api: Hono, ctx: Ctx) {
  const { model, db, write, recurringOverrides } = ctx
  const items = (m: Computed) =>
    detectRecurring(m, recurringOverrides()).map((i) => ({
      ...i,
      categoryLabel: m.category(i.category).label,
      accountName: m.account.get(i.accountId)?.name ?? "Account",
    }))
  const monthly = (i: RecurringItem) =>
    (i.amountCents * 30.44) / cadenceDays(i.cadence)

  api.get("/recurring", (c) => {
    const m = model.get()
    const month = isMonth(c.req.query("month"))
      ? c.req.query("month")!
      : monthOf(m.today)
    const all = items(m)
    const active = all.filter((i) => i.status === "active")
    const from = `${month}-01`
    const to = monthEnd(month)
    const calendar = active.flatMap((i) =>
      schedule(i, from, to, m.today).map((o) => ({
        ...o,
        key: i.key,
        merchant: i.merchant,
        kind: i.kind,
        category: i.category,
      }))
    )
    const bills = cardBills(m)
    return c.json({
      today: m.today,
      month,
      monthlyExpenseCents: Math.round(
        -active
          .filter((i) => i.kind === "expense")
          .reduce((s, i) => s + monthly(i), 0)
      ),
      monthlyIncomeCents: Math.round(
        active
          .filter((i) => i.kind === "income")
          .reduce((s, i) => s + monthly(i), 0)
      ),
      // This month's expected charges, and how many are still to come.
      monthPaidCents: calendar
        .filter((o) => o.state === "paid" && o.kind === "expense")
        .reduce((s, o) => s - o.amountCents, 0),
      monthDueCents: calendar
        .filter((o) => o.state !== "paid" && o.kind === "expense")
        .reduce((s, o) => s - o.amountCents, 0),
      calendar: calendar.sort((a, b) => (a.date < b.date ? -1 : 1)),
      bills,
      items: all.map((i) => ({ ...i, history: i.history.slice(-12) })),
    })
  })

  api.get("/recurring/:key", (c) => {
    const m = model.get()
    const key = normalizeText(c.req.param("key"))
    const item = items(m).find((i) => i.key === key)
    if (!item) throw notFound("Recurring item")
    const start = item.history[0]?.date ?? m.today
    const past = schedule(item, start, m.today, m.today)
    const upcoming = Array.from({ length: 6 }, (_, n) =>
      nextOccurrence(item.lastDate, item.cadence, n + 1)
    ).filter((d) => d >= m.today)
    const total = item.history.reduce((s, h) => s + h.amountCents, 0)
    return c.json({
      ...item,
      averageCents: item.history.length
        ? Math.round(total / item.history.length)
        : 0,
      // The last twelve months against what this is expected to cost.
      yearCents: item.history
        .filter((h) => h.date > addDays(m.today, -365))
        .reduce((s, h) => s + h.amountCents, 0),
      monthlyCents: Math.round(monthly(item)),
      /** A hand edit exists, so DELETE returns it to detection. */
      edited: recurringOverrides().has(key),
      missed: past.filter((o) => o.state === "missed").length,
      upcoming: upcoming.map((date) => ({
        date,
        amountCents: item.amountCents,
      })),
      transactions: item.history
        .toReversed()
        .slice(0, 50)
        .map((h) => txnJson(m, m.txn.get(h.id)!)),
    })
  })

  /** Edit or add (mark as recurring by hand) the item for a merchant. */
  api.patch("/recurring/:key", async (c) => {
    const b = await body(
      c,
      z
        .object({
          status: z.enum(["active", "ignored", "cancelled"]).optional(),
          cadence: CADENCE.nullable().optional(),
          expectedCents: z
            .number()
            .int()
            .refine((v) => Math.abs(v) <= 1e12)
            .nullable()
            .optional(),
        })
        .strict()
    )
    const key = normalizeText(c.req.param("key"))
    const m = model.get()
    if (!m.txns.some((t) => t.merchantKey === key)) throw notFound("Merchant")
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
          b.expectedCents === undefined
            ? (cur?.expected_cents ?? null)
            : b.expectedCents
        )
    )
    return c.json({ ok: true })
  })
  /** Forget a hand edit; detection decides again. */
  api.delete("/recurring/:key", (c) => {
    const key = normalizeText(c.req.param("key"))
    write(() =>
      db
        .prepare("DELETE FROM recurring_overrides WHERE merchant_key=?")
        .run(key)
    )
    return c.json({ ok: true })
  })
}
