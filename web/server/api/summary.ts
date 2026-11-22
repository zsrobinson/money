import { Hono } from "hono"
import {
  addDays,
  addMonths,
  asRange,
  categoryTotals,
  detectRecurring,
  earliestDate,
  monthEnd,
  monthOf,
  monthlyFlows,
  netWorthSeries,
  rangeStart,
  sampleDates,
  spendCents,
} from "../analytics.ts"
import { budgetSummary } from "./budgets.ts"
import { goalViews } from "./goals.ts"
import { accountJson, txnJson, type Ctx } from "./context.ts"

export function registerSummary(api: Hono, ctx: Ctx) {
  const { model, settings, recurringOverrides } = ctx
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
        if (
          !a.txn.pending &&
          a.group === "expense" &&
          monthOf(a.txn.date) === mon
        )
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
      .map(([code, t]) => ({
        code,
        label: m.category(code).label,
        cents: t.cents,
      }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => b.cents - a.cents)
    const overrides = recurringOverrides()
    const upcoming = detectRecurring(m, overrides)
      .filter(
        (r) =>
          r.status === "active" &&
          r.nextDate >= m.today &&
          r.nextDate <= addDays(m.today, 31)
      )
      .slice(0, 6)
      .map((r) => ({ ...r, history: undefined }))
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
      budget: budgetSummary(ctx, m, month),
      upcoming,
      accounts: m.accounts
        .filter((a) => !a.hidden && a.availability === "available")
        .map(accountJson),
      // A matched transfer is two rows that cancel out; leave both off.
      recent: m.txns
        .filter((t) => !t.hidden && !t.transferPairId)
        .slice(0, 10)
        .map((t) => txnJson(m, t)),
      unreviewed: m.txns.filter((t) => t.needsReview).length,
      // The newest few waiting, so the dashboard can clear them inline.
      review: m.txns
        .filter((t) => t.needsReview)
        .slice(0, 4)
        .map((t) => txnJson(m, t)),
      goals: goalViews(ctx, m).map((g) => ({ ...g, series: undefined })),
    })
  })
}
