import { Hono } from "hono"
import { z } from "zod"
import { accountSeries, addDays, isDate, sampleDates } from "../analytics.ts"
import type { Computed } from "../model.ts"
import { body, HttpError, id, notFound, now, type Ctx } from "./context.ts"

const Allocation = z
  .object({
    accountId: z.string().min(1),
    /** The whole balance, a fixed amount of it, or a share of it. */
    mode: z.enum(["all", "amount", "percent"]),
    /** Cents for an amount; basis points (100% = 10000) for a share. */
    value: z.number().int().min(0).max(1e13).nullable().optional(),
  })
  .strict()
  .refine((a) => a.mode === "all" || (a.value != null && a.value > 0), {
    message: "Enter an amount or share for each account",
  })
  .refine((a) => a.mode !== "percent" || (a.value ?? 0) <= 10000, {
    message: "A share can be at most 100%",
  })
export const GoalBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["save", "payoff"]),
    targetCents: z.number().int().positive().max(1e13),
    targetDate: z
      .string()
      .refine(isDate, "Use a valid date")
      .nullable()
      .optional(),
    /** Planned saving each month; shows in Budgets. */
    monthlyCents: z.number().int().min(0).max(1e12).nullable().optional(),
    allocations: z
      .array(Allocation)
      .min(1, "Choose at least one account")
      .max(20)
      .refine(
        (xs) => new Set(xs.map((x) => x.accountId)).size === xs.length,
        "Each account once"
      ),
  })
  .strict()

type GoalRow = {
  id: string
  name: string
  kind: "save" | "payoff"
  target_cents: number
  target_date: string | null
  monthly_cents: number | null
  created_at: string
}
type AllocationRow = {
  goal_id: string
  account_id: string
  mode: "all" | "amount" | "percent"
  value: number | null
}

/** What part of a balance a goal counts. Payoff goals count what is owed. */
const share = (a: AllocationRow, balance: number) => {
  const base = Math.max(0, balance)
  if (a.mode === "amount") return Math.min(a.value ?? 0, base)
  if (a.mode === "percent") return Math.round((base * (a.value ?? 0)) / 10000)
  return base
}

/**
 * Accounts that more than one goal counts beyond their balance: two goals
 * taking all of it, shares over 100%, or amounts over the balance.
 */
function overlaps(m: Computed, goals: GoalRow[], allocations: AllocationRow[]) {
  const byAccount = new Map<string, AllocationRow[]>()
  for (const a of allocations)
    byAccount.set(a.account_id, [...(byAccount.get(a.account_id) ?? []), a])
  const out: {
    accountId: string
    accountName: string
    goalIds: string[]
    goals: string[]
  }[] = []
  for (const [accountId, list] of byAccount) {
    if (list.length < 2) continue
    const account = m.account.get(accountId)
    if (!account) continue
    const balance = Math.abs(account.balanceCents ?? 0)
    const claimed = list.reduce(
      (s, a) =>
        s +
        (a.mode === "all"
          ? balance
          : a.mode === "percent"
            ? (balance * (a.value ?? 0)) / 10000
            : (a.value ?? 0)),
      0
    )
    if (claimed <= balance + 1) continue
    out.push({
      accountId,
      accountName: account.name,
      goalIds: list.map((a) => a.goal_id),
      goals: list.map((a) => goals.find((g) => g.id === a.goal_id)?.name ?? ""),
    })
  }
  return out
}

export function goalViews(ctx: Ctx, m: Computed) {
  const goals = ctx.db
    .prepare("SELECT * FROM goals ORDER BY created_at")
    .all() as GoalRow[]
  const allocations = ctx.db
    .prepare("SELECT * FROM goal_allocations")
    .all() as AllocationRow[]
  const clashes = overlaps(m, goals, allocations)
  const dates = sampleDates(addDays(m.today, -365), m.today, 52)
  return goals.map((g) => {
    const mine = allocations.filter(
      (a) => a.goal_id === g.id && m.account.has(a.account_id)
    )
    const sign = g.kind === "payoff" ? -1 : 1
    const current = mine.reduce(
      (s, a) =>
        s + share(a, sign * (m.account.get(a.account_id)!.balanceCents ?? 0)),
      0
    )
    const values = dates.map(() => 0)
    for (const a of mine)
      accountSeries(m, m.account.get(a.account_id)!, dates).forEach(
        (v, i) => (values[i] += share(a, sign * (v ?? 0)))
      )
    const progress =
      g.kind === "payoff"
        ? Math.min(1, Math.max(0, (g.target_cents - current) / g.target_cents))
        : Math.min(1, Math.max(0, current / g.target_cents))
    // Average monthly change over the last 90 days projects a finish date.
    const back = mine.length ? values[Math.max(0, values.length - 14)] : current
    const perMonth = ((current - back) / 90) * 30.44
    const remaining = g.kind === "payoff" ? current : g.target_cents - current
    const towards = g.kind === "payoff" ? -perMonth : perMonth
    const projected =
      remaining <= 0
        ? m.today
        : towards > 0
          ? addDays(m.today, Math.ceil((remaining / towards) * 30.44))
          : null
    const monthsLeft = g.target_date
      ? Math.max(
          1,
          (Date.parse(g.target_date) - Date.parse(m.today)) /
            (30.44 * 86_400_000)
        )
      : null
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      targetCents: g.target_cents,
      targetDate: g.target_date,
      monthlyCents: g.monthly_cents,
      allocations: mine.map((a) => ({
        accountId: a.account_id,
        accountName: m.account.get(a.account_id)!.name,
        mode: a.mode,
        value: a.value,
        cents: share(
          a,
          sign * (m.account.get(a.account_id)!.balanceCents ?? 0)
        ),
      })),
      accountIds: mine.map((a) => a.account_id),
      accountNames: mine.map((a) => m.account.get(a.account_id)!.name),
      currentCents: current,
      progress,
      monthlyChangeCents: Math.round(perMonth),
      /** What it takes each month from now to reach the target by its date. */
      neededMonthlyCents:
        monthsLeft && remaining > 0 ? Math.round(remaining / monthsLeft) : null,
      projectedDate: projected,
      onTrack: g.target_date && projected ? projected <= g.target_date : null,
      overlaps: clashes
        .filter((x) => x.goalIds.includes(g.id))
        .map((x) => ({
          accountId: x.accountId,
          accountName: x.accountName,
          goals: x.goals.filter((name) => name !== g.name),
        })),
      series: dates.map((date, i) => ({ date, cents: values[i] })),
      createdAt: g.created_at,
    }
  })
}

export function registerGoals(api: Hono, ctx: Ctx) {
  const { model, db, write } = ctx
  api.get("/goals", (c) => c.json(goalViews(ctx, model.get())))
  api.get("/goals/:id", (c) => {
    const g = goalViews(ctx, model.get()).find(
      (x) => x.id === c.req.param("id")
    )
    if (!g) throw notFound("Goal")
    return c.json(g)
  })
  const check = (m: Computed, b: z.infer<typeof GoalBody>) => {
    for (const a of b.allocations) {
      const acct = m.account.get(a.accountId)
      if (!acct) throw new HttpError(422, "Choose existing accounts")
      if (b.kind === "payoff" && !acct.liability)
        throw new HttpError(422, "Payoff goals track credit or loan accounts")
      if (b.kind === "save" && acct.liability)
        throw new HttpError(
          422,
          "Savings goals track cash, investment or other asset accounts"
        )
    }
  }
  const saveAllocations = (goalId: string, b: z.infer<typeof GoalBody>) => {
    db.prepare("DELETE FROM goal_allocations WHERE goal_id=?").run(goalId)
    for (const a of b.allocations)
      db.prepare("INSERT INTO goal_allocations VALUES(?,?,?,?)").run(
        goalId,
        a.accountId,
        a.mode,
        a.mode === "all" ? null : (a.value ?? null)
      )
  }
  api.post("/goals", async (c) => {
    const b = await body(c, GoalBody)
    check(model.get(), b)
    const goalId = id("goal")
    write(() => {
      db.prepare(
        "INSERT INTO goals(id,name,kind,target_cents,target_date,account_ids_json,created_at,monthly_cents) VALUES(?,?,?,?,?,?,?,?)"
      ).run(
        goalId,
        b.name,
        b.kind,
        b.targetCents,
        b.targetDate ?? null,
        JSON.stringify(b.allocations.map((a) => a.accountId)),
        now(),
        b.monthlyCents ?? null
      )
      saveAllocations(goalId, b)
    })
    return c.json({ id: goalId }, 201)
  })
  api.put("/goals/:id", async (c) => {
    const b = await body(c, GoalBody)
    check(model.get(), b)
    const goalId = c.req.param("id")
    if (!db.prepare("SELECT 1 FROM goals WHERE id=?").get(goalId))
      throw notFound("Goal")
    write(() => {
      db.prepare(
        "UPDATE goals SET name=?, kind=?, target_cents=?, target_date=?, account_ids_json=?, monthly_cents=? WHERE id=?"
      ).run(
        b.name,
        b.kind,
        b.targetCents,
        b.targetDate ?? null,
        JSON.stringify(b.allocations.map((a) => a.accountId)),
        b.monthlyCents ?? null,
        goalId
      )
      saveAllocations(goalId, b)
    })
    return c.json({ ok: true })
  })
  api.delete("/goals/:id", (c) => {
    write(() => {
      db.prepare("DELETE FROM goal_allocations WHERE goal_id=?").run(
        c.req.param("id")
      )
      db.prepare("DELETE FROM goals WHERE id=?").run(c.req.param("id"))
    })
    return c.json({ ok: true })
  })
}
