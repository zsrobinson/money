import { Hono } from "hono"
import { asRange, rangeStart, sampleDates } from "../analytics.ts"
import type { Computed } from "../model.ts"
import { accountJson, notFound, type Ctx } from "./context.ts"

export function registerInvestments(api: Hono, ctx: Ctx) {
  const { model } = ctx
  api.get("/investments", (c) => {
    const m = model.get()
    const range = asRange(c.req.query("range"), "1y")
    const holdings = m.detail.holdings.map((h) => ({
      ...h,
      accountName: m.account.get(h.accountId)?.name ?? "Account",
      gainCents:
        h.costBasisCents == null ? null : h.valueCents - h.costBasisCents,
    }))
    const total = holdings.reduce((s, h) => s + h.valueCents, 0)
    const basis = holdings.filter((h) => h.costBasisCents != null)
    const byType = new Map<string, number>()
    for (const h of holdings)
      byType.set(h.type, (byType.get(h.type) ?? 0) + h.valueCents)
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
    const accounts = m.accounts.filter(
      (a) =>
        a.type === "investment" || holdings.some((h) => h.accountId === a.id)
    )
    return c.json({
      range,
      totalCents: total,
      costBasisCents: basis.reduce((s, h) => s + (h.costBasisCents ?? 0), 0),
      gainCents: basis.reduce((s, h) => s + (h.gainCents ?? 0), 0),
      allocation: [...byType]
        .map(([type, cents]) => ({ type, cents }))
        .sort((a, b) => b.cents - a.cents),
      series: dates
        .filter((d) => byDate.has(d))
        .map((date) => ({ date, cents: byDate.get(date)! })),
      accounts: accounts.map((a) => ({
        ...accountJson(a),
        holdingsCents: holdings
          .filter((h) => h.accountId === a.id)
          .reduce((s, h) => s + h.valueCents, 0),
      })),
      holdings: holdings.sort((a, b) => b.valueCents - a.valueCents),
      positions: positions(holdings),
      performance: performance(
        m,
        dates.find((d) => byDate.has(d)) ?? m.today,
        byDate.get(dates.find((d) => byDate.has(d)) ?? "") ?? null,
        total
      ),
    })
  })

  /** One security across every account that holds it. */
  api.get("/investments/holdings/:security", (c) => {
    const m = model.get()
    const sid = c.req.param("security")
    const lots = m.detail.holdings.filter((h) => h.securityId === sid)
    if (!lots.length) throw notFound("Holding")
    const first = lots[0]
    const byDate = new Map<string, number>()
    for (const h of m.detail.holdingHistory)
      if (h.securityId === sid)
        byDate.set(h.date, (byDate.get(h.date) ?? 0) + h.valueCents)
    const value = lots.reduce((s, h) => s + h.valueCents, 0)
    const basis = lots.every((h) => h.costBasisCents != null)
      ? lots.reduce((s, h) => s + (h.costBasisCents ?? 0), 0)
      : null
    return c.json({
      securityId: sid,
      ticker: first.ticker,
      name: first.name,
      type: first.type,
      price: first.price,
      quantity: lots.reduce((s, h) => s + h.quantity, 0),
      valueCents: value,
      costBasisCents: basis,
      gainCents: basis == null ? null : value - basis,
      accounts: lots.map((h) => ({
        accountId: h.accountId,
        accountName: m.account.get(h.accountId)?.name ?? "Account",
        quantity: h.quantity,
        valueCents: h.valueCents,
        costBasisCents: h.costBasisCents,
      })),
      series: [...byDate]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, cents]) => ({ date, cents })),
      transactions: m.detail.investmentTransactions
        .filter((t) => t.securityId === sid)
        .slice(0, 100)
        .map((t) => ({
          ...t,
          accountName: m.account.get(t.accountId)?.name ?? "Account",
        })),
    })
  })
}

/** The same security held in several accounts, added together. */
function positions(
  holdings: {
    securityId: string
    ticker: string | null
    name: string
    type: string
    quantity: number
    valueCents: number
    costBasisCents: number | null
    accountId: string
  }[]
) {
  const out = new Map<
    string,
    {
      securityId: string
      ticker: string | null
      name: string
      type: string
      quantity: number
      valueCents: number
      costBasisCents: number | null
      accounts: number
    }
  >()
  for (const h of holdings) {
    const p = out.get(h.securityId) ?? {
      securityId: h.securityId,
      ticker: h.ticker,
      name: h.name,
      type: h.type,
      quantity: 0,
      valueCents: 0,
      costBasisCents: 0 as number | null,
      accounts: 0,
    }
    p.quantity += h.quantity
    p.valueCents += h.valueCents
    p.costBasisCents =
      p.costBasisCents == null || h.costBasisCents == null
        ? null
        : p.costBasisCents + h.costBasisCents
    p.accounts++
    out.set(h.securityId, p)
  }
  return [...out.values()]
    .map((p) => ({
      ...p,
      gainCents:
        p.costBasisCents == null ? null : p.valueCents - p.costBasisCents,
    }))
    .sort((a, b) => b.valueCents - a.valueCents)
}

const CONTRIBUTION = new Set([
  "contribution",
  "deposit",
  "withdrawal",
  "transfer",
])
/**
 * Over a range: money put in (contributions less withdrawals), dividends and
 * interest, and the market's part of the change in value. The return is a
 * simple Modified Dietz estimate, counting contributions as if made half way
 * through. Null without investment transactions from the bank.
 */
function performance(
  m: Computed,
  from: string,
  startCents: number | null,
  endCents: number
) {
  const txns = m.detail.investmentTransactions
  if (!txns.length || startCents == null) return null
  let contributions = 0
  let income = 0
  let fees = 0
  for (const t of txns) {
    if (t.date <= from || t.date > m.today) continue
    const sub = (t.subtype ?? "").toLowerCase()
    if (
      (t.type === "cash" || t.type === "transfer") &&
      (CONTRIBUTION.has(sub) || t.type === "transfer")
    )
      contributions += t.amountCents
    else if (
      sub === "dividend" ||
      sub === "interest" ||
      sub.includes("dividend")
    )
      income += t.amountCents
    else if (t.type === "fee") fees += t.amountCents
  }
  const change = endCents - startCents
  const market = change - contributions
  const base = startCents + contributions / 2
  return {
    from,
    startCents,
    endCents,
    contributionsCents: contributions,
    incomeCents: income,
    feesCents: fees,
    marketCents: market,
    returnRate: base > 0 ? market / base : null,
  }
}
