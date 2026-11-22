import { Hono } from "hono"
import { z } from "zod"
import {
  addMonths,
  earliestDate,
  isMonth,
  monthEnd,
  monthOf,
  monthlyFlows,
  monthsBetween,
  spendCents,
} from "../analytics.ts"
import type { BudgetKind, CategoryInfo, Computed } from "../model.ts"
import { body, HttpError, notFound, type Ctx } from "./context.ts"

/** The flexible pool's key in budget_plans and budgets. */
export const FLEXIBLE = "__flexible"
/** A stored negative amount means "no budget" from that month (or that month only). */
const NONE = -1

type Amount = { cents: number | null; source: "month" | "plan" | null }

/**
 * Budget amounts and spending by month. Typing an amount sets it for that
 * month and every later one (a plan); "only this month" is a month row that
 * wins over the plan. A parent's budget is its own amount plus its
 * children's, and its spending includes theirs, so totals over top-level
 * categories count each dollar once.
 */
export function budgetBook(ctx: Ctx, m: Computed) {
  const { db, settings } = ctx
  const months = new Map<string, Map<string, number>>()
  for (const r of db
    .prepare("SELECT month, category, amount_cents FROM budgets")
    .all() as { month: string; category: string; amount_cents: number }[]) {
    let mm = months.get(r.month)
    if (!mm) months.set(r.month, (mm = new Map()))
    mm.set(r.category, r.amount_cents)
  }
  const plans = new Map<string, { from: string; cents: number }[]>()
  for (const r of db
    .prepare(
      "SELECT category, from_month, amount_cents FROM budget_plans ORDER BY from_month"
    )
    .all() as { category: string; from_month: string; amount_cents: number }[])
    plans.set(r.category, [
      ...(plans.get(r.category) ?? []),
      { from: r.from_month, cents: r.amount_cents },
    ])
  const planFor = (month: string, code: string) =>
    plans.get(code)?.findLast((p) => p.from <= month)
  const amount = (month: string, code: string): Amount => {
    const own = months.get(month)?.get(code)
    if (own != null)
      return { cents: own < 0 ? null : own, source: own < 0 ? null : "month" }
    const plan = planFor(month, code)
    if (plan && plan.cents >= 0) return { cents: plan.cents, source: "plan" }
    return { cents: null, source: null }
  }
  const children = new Map<string, CategoryInfo[]>()
  for (const x of m.categories)
    if (x.parent) children.set(x.parent, [...(children.get(x.parent) ?? []), x])
  const mode = settings().budgetMode
  /** Flexible categories share one pool in flex mode; they have no own amounts. */
  const kindOf = (code: string): BudgetKind => {
    if (mode !== "flex") return "fixed"
    const c = m.category(code)
    return (c.parent ? m.category(c.parent) : c).budgetKind
  }
  const own = (month: string, code: string) =>
    kindOf(code) === "flexible" ? null : amount(month, code).cents
  /** Own amount plus the children's; null when none of them has one. */
  const totalOf = (month: string, code: string) => {
    let total: number | null = own(month, code)
    for (const child of children.get(code) ?? []) {
      const b = own(month, child.code)
      if (b != null) total = (total ?? 0) + b
    }
    return total
  }
  const spentByMonth = new Map<string, Map<string, number>>()
  const add = (month: string, code: string, cents: number) => {
    let mm = spentByMonth.get(month)
    if (!mm) spentByMonth.set(month, (mm = new Map()))
    mm.set(code, (mm.get(code) ?? 0) + cents)
  }
  for (const a of m.allocations) {
    if (a.txn.pending || a.group === "transfer") continue
    const month = monthOf(a.txn.date)
    // Income reads positive as received; spending positive as spent.
    const cents = a.group === "income" ? a.amountCents : spendCents(a)
    add(month, `own:${a.category}`, cents)
    add(month, a.category, cents)
    const parent = m.category(a.category).parent
    if (parent) add(month, parent, cents)
    if (a.group === "expense" && kindOf(a.category) === "flexible")
      add(month, FLEXIBLE, cents)
  }
  const spent = (month: string, code: string) =>
    spentByMonth.get(month)?.get(code) ?? 0
  /** Spending in a category itself, not its children. */
  const spentOwn = (month: string, code: string) => spent(month, `own:${code}`)
  const firstMonth = monthOf(earliestDate(m))
  const rollover = settings().budgetRollover
  /**
   * Unspent (or overspent) budget carried into `month`. Non-monthly
   * categories in flex mode always carry, from their first budgeted month.
   */
  const carried = (month: string, code: string) => {
    let since: string | undefined = rollover[code]
    if (code !== FLEXIBLE && kindOf(code) === "non_monthly")
      since = plans.get(code)?.find((p) => p.cents >= 0)?.from ?? since
    if (!since) return 0
    if (since < firstMonth) since = firstMonth
    let carry = 0
    for (let mo = since; mo < month; mo = addMonths(mo, 1)) {
      const budget = code === FLEXIBLE ? own(mo, FLEXIBLE) : totalOf(mo, code)
      if (budget == null) continue
      carry += budget - spent(mo, code)
    }
    return carry
  }
  return {
    mode,
    amount,
    totalOf,
    spent,
    spentOwn,
    carried,
    kindOf,
    rollover,
    planFor,
    months,
    poolAmount: (month: string) =>
      mode === "flex" ? amount(month, FLEXIBLE) : { cents: null, source: null },
  }
}

export type BudgetLine = ReturnType<typeof budgetMonth>["expenses"][number]

/** Every row, the flexible pool and the month's totals. */
export function budgetMonth(ctx: Ctx, m: Computed, month: string) {
  const book = budgetBook(ctx, m)
  const avg3 = (code: string) =>
    Math.round(
      [1, 2, 3].reduce(
        (sum, n) => sum + book.spent(addMonths(month, -n), code),
        0
      ) / 3
    )
  const row = (x: CategoryInfo) => {
    const a = book.amount(month, x.code)
    const kind = book.kindOf(x.code)
    const total = book.totalOf(month, x.code)
    const hasChildBudgets =
      x.group === "expense" &&
      m.categories.some(
        (c) => c.parent === x.code && book.amount(month, c.code).cents != null
      )
    return {
      code: x.code,
      label: x.label,
      parent: x.parent,
      custom: x.custom,
      group: x.group,
      icon: x.icon,
      color: x.color,
      kind,
      /** This category's own amount, the one you edit. */
      budgetCents: kind === "flexible" ? null : a.cents,
      /** "month": only this month; "plan": this month and later. */
      source: a.source,
      /** Own amount plus the categories inside it. */
      totalBudgetCents: total,
      /** Its children have amounts, so its own total is read-only. */
      hasChildBudgets,
      rollover: Boolean(book.rollover[x.code]) || kind === "non_monthly",
      rolloverCents:
        total == null || x.group === "income" ? 0 : book.carried(month, x.code),
      /** Includes the categories inside it. */
      spentCents: book.spent(month, x.code),
      /** Only this category itself, for its "everything else" line. */
      ownSpentCents: book.spentOwn(month, x.code),
      lastMonthCents: book.spent(addMonths(month, -1), x.code),
      averageCents: avg3(x.code),
    }
  }
  const visible = m.categories.filter((x) => !x.hidden)
  const expenses = visible.filter((x) => x.group === "expense").map(row)
  const income = visible.filter((x) => x.group === "income").map(row)
  const pool = book.poolAmount(month)
  const flexible =
    book.mode === "flex"
      ? {
          budgetCents: pool.cents,
          source: pool.source,
          spentCents: book.spent(month, FLEXIBLE),
          rolloverCents: book.rollover[FLEXIBLE]
            ? book.carried(month, FLEXIBLE)
            : 0,
          rollover: Boolean(book.rollover[FLEXIBLE]),
          averageCents: avg3(FLEXIBLE),
        }
      : null
  // Each dollar once: only top-level categories add up.
  let budgetedCents = 0
  let plannedCents = 0
  let spentInBudgets = 0
  let outsideCents = 0
  for (const r of expenses) {
    if (r.parent) continue
    if (r.kind === "flexible") {
      if (pool.cents == null) outsideCents += r.spentCents
      continue
    }
    if (r.totalBudgetCents == null) outsideCents += r.spentCents
    else {
      plannedCents += r.totalBudgetCents
      budgetedCents += r.totalBudgetCents + r.rolloverCents
      spentInBudgets += r.spentCents
    }
  }
  if (flexible && pool.cents != null) {
    plannedCents += pool.cents
    budgetedCents += pool.cents + flexible.rolloverCents
    spentInBudgets += flexible.spentCents
  }
  let plannedIncome: number | null = null
  for (const r of income)
    if (!r.parent && r.totalBudgetCents != null)
      plannedIncome = (plannedIncome ?? 0) + r.totalBudgetCents
  const goals = (
    ctx.db
      .prepare(
        "SELECT id, name, monthly_cents FROM goals WHERE monthly_cents > 0 ORDER BY created_at"
      )
      .all() as { id: string; name: string; monthly_cents: number }[]
  ).map((g) => ({ id: g.id, name: g.name, monthlyCents: g.monthly_cents }))
  const goalCents = goals.reduce((s, g) => s + g.monthlyCents, 0)
  const flow = monthlyFlows(m, [month])[0]
  return {
    mode: book.mode,
    expenses,
    income,
    flexible,
    goals,
    totals: {
      /** Budgets plus rollover, over top-level rows and the pool. */
      budgetedCents,
      /** Spent in categories that have a budget. */
      spentCents: spentInBudgets,
      /** Spent in categories without one. */
      unbudgetedCents: outsideCents,
      /** All spending, the same figure as cash flow. */
      totalSpentCents: flow.spendingCents,
      incomeCents: flow.incomeCents,
      plannedIncomeCents: plannedIncome,
      plannedExpenseCents: plannedCents,
      goalsCents: goalCents,
      /** Planned income less planned spending and goal saving. */
      leftToBudgetCents:
        plannedIncome == null ? null : plannedIncome - plannedCents - goalCents,
    },
  }
}

/** The dashboard card: totals and the five busiest budgets with their children. */
export function budgetSummary(ctx: Ctx, m: Computed, month: string) {
  const b = budgetMonth(ctx, m, month)
  const ratio = (r: BudgetLine) =>
    r.spentCents / Math.max(1, (r.totalBudgetCents ?? 0) + r.rolloverCents)
  const top = b.expenses.filter(
    (r) => !r.parent && r.totalBudgetCents != null && r.kind !== "flexible"
  )
  return {
    month,
    ...b.totals,
    flexible: b.flexible,
    over: b.expenses.filter(
      (r) =>
        r.totalBudgetCents != null &&
        r.spentCents > r.totalBudgetCents + r.rolloverCents
    ).length,
    rows: top
      .sort((x, y) => ratio(y) - ratio(x))
      .slice(0, 5)
      .map((r) => ({
        ...r,
        children: b.expenses.filter(
          (x) =>
            x.parent === r.code &&
            (x.totalBudgetCents != null || x.spentCents > 0)
        ),
      })),
  }
}

const BudgetPut = z
  .object({
    amountCents: z.number().int().min(0).max(1e12).nullable(),
    /** "forward" (default): this month and later. "month": only this month. */
    scope: z.enum(["forward", "month"]).optional(),
    /** Remove the "only this month" amount, falling back to the plan. */
    reset: z.boolean().optional(),
  })
  .strict()

export function registerBudgets(api: Hono, ctx: Ctx) {
  const { model, db, write, settings, setSetting } = ctx
  const budgetable = (m: Computed, code: string) => {
    if (code === FLEXIBLE) return true
    return m.categories.some(
      (x) => x.code === code && (x.group === "expense" || x.group === "income")
    )
  }
  /** Set (or clear, with null) the amount from `month` on, or for it alone. */
  const setAmount = (
    code: string,
    month: string,
    cents: number | null,
    scope: "forward" | "month"
  ) => {
    const stored = cents ?? NONE
    if (scope === "month") {
      db.prepare(
        "INSERT INTO budgets VALUES(?,?,?) ON CONFLICT(month,category) DO UPDATE SET amount_cents=excluded.amount_cents"
      ).run(month, code, stored)
      return
    }
    // A new amount replaces every later plan and one-off amount.
    db.prepare(
      "DELETE FROM budget_plans WHERE category=? AND from_month>?"
    ).run(code, month)
    db.prepare("DELETE FROM budgets WHERE category=? AND month>=?").run(
      code,
      month
    )
    const earlier = db
      .prepare(
        "SELECT amount_cents FROM budget_plans WHERE category=? AND from_month<? ORDER BY from_month DESC LIMIT 1"
      )
      .get(code, month) as { amount_cents: number } | undefined
    // Clearing with nothing before needs no marker.
    if (cents == null && (!earlier || earlier.amount_cents < 0))
      db.prepare(
        "DELETE FROM budget_plans WHERE category=? AND from_month=?"
      ).run(code, month)
    else
      db.prepare(
        "INSERT INTO budget_plans VALUES(?,?,?) ON CONFLICT(category,from_month) DO UPDATE SET amount_cents=excluded.amount_cents"
      ).run(code, month, stored)
  }

  api.get("/budgets", (c) => {
    const m = model.get()
    const month = isMonth(c.req.query("month"))
      ? c.req.query("month")!
      : monthOf(m.today)
    const day =
      month === monthOf(m.today)
        ? Number(m.today.slice(8, 10))
        : month < monthOf(m.today)
          ? Number(monthEnd(month).slice(8, 10))
          : 0
    return c.json({
      month,
      current: monthOf(m.today),
      elapsed: day / Number(monthEnd(month).slice(8, 10)),
      ...budgetMonth(ctx, m, month),
    })
  })
  api.get("/budgets/history", (c) => {
    const m = model.get()
    const count = Math.min(24, Math.max(3, Number(c.req.query("months")) || 12))
    const end = monthOf(m.today)
    const book = budgetBook(ctx, m)
    const months = monthsBetween(addMonths(end, -(count - 1)), end)
    const tops = m.categories.filter((x) => x.group === "expense" && !x.parent)
    return c.json({
      months: months.map((month) => {
        let budgetCents = 0
        let spentCents = 0
        for (const k of tops) {
          if (book.kindOf(k.code) === "flexible") continue
          const b = book.totalOf(month, k.code)
          if (b == null) continue
          budgetCents += b
          spentCents += book.spent(month, k.code)
        }
        const pool = book.poolAmount(month).cents
        if (pool != null) {
          budgetCents += pool
          spentCents += book.spent(month, FLEXIBLE)
        }
        return { month, budgetCents, spentCents }
      }),
    })
  })
  api.put("/budgets/rollover/:category", async (c) => {
    const b = await body(
      c,
      z
        .object({
          enabled: z.boolean(),
          since: z.string().refine(isMonth).optional(),
        })
        .strict()
    )
    const m = model.get()
    const code = c.req.param("category")
    if (
      code !== FLEXIBLE &&
      !m.categories.some((x) => x.code === code && x.group === "expense")
    )
      throw notFound("Category")
    const next = { ...settings().budgetRollover }
    if (b.enabled) next[code] = b.since ?? monthOf(m.today)
    else delete next[code]
    write(() => setSetting("budgetRollover", next))
    return c.json({ ok: true })
  })
  api.put("/budgets/:month/:category", async (c) => {
    const month = c.req.param("month")
    if (!isMonth(month)) throw new HttpError(422, "Use a YYYY-MM month")
    const b = await body(c, BudgetPut)
    const code = c.req.param("category")
    if (!budgetable(model.get(), code)) throw notFound("Category")
    write(() => {
      if (b.reset)
        db.prepare("DELETE FROM budgets WHERE month=? AND category=?").run(
          month,
          code
        )
      else setAmount(code, month, b.amountCents, b.scope ?? "forward")
    })
    return c.json({ ok: true })
  })
  /** Make this month's amounts last month's, from here on. */
  api.post("/budgets/:month/copy-previous", (c) => {
    const month = c.req.param("month")
    if (!isMonth(month)) throw new HttpError(422, "Use a YYYY-MM month")
    const m = model.get()
    const book = budgetBook(ctx, m)
    const prev = addMonths(month, -1)
    let copied = 0
    write(() => {
      for (const x of [...m.categories.map((x) => x.code), FLEXIBLE]) {
        if (!budgetable(m, x)) continue
        const before = book.amount(prev, x).cents
        if (before === book.amount(month, x).cents) continue
        setAmount(x, month, before, "forward")
        copied++
      }
    })
    return c.json({ copied })
  })
  api.put("/budgets/mode", async (c) => {
    const b = await body(
      c,
      z.object({ mode: z.enum(["category", "flex"]) }).strict()
    )
    write(() => setSetting("budgetMode", b.mode))
    return c.json({ ok: true })
  })
}
