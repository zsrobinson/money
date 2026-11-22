import { Hono } from "hono"
import {
  addMonths,
  asRange,
  categoryTotals,
  detectRecurring,
  earliestDate,
  isDate,
  monthOf,
  monthlyFlows,
  monthsBetween,
  reportPeriod,
  spendCents,
  topLevelSum,
  withChildren,
} from "../analytics.ts"
import type { Allocation, Computed } from "../model.ts"
import { buckets, comparison, period, type Interval } from "../periods.ts"
import { notFound, txnJson, type Ctx } from "./context.ts"

export type Measure = "spending" | "income" | "net"
export type GroupBy =
  "category" | "group" | "merchant" | "tag" | "account" | "none"

/** What an allocation adds to a measure, or undefined when it does not count. */
function measureOf(a: Allocation, measure: Measure) {
  if (a.txn.pending || a.group === "transfer") return undefined
  if (measure === "spending")
    return a.group === "expense" ? spendCents(a) : undefined
  if (measure === "income")
    return a.group === "income" ? a.amountCents : undefined
  return a.amountCents
}

/** The keys an allocation is grouped under; a transaction with two tags counts under both. */
function keysOf(m: Computed, a: Allocation, by: GroupBy): string[] {
  switch (by) {
    case "category":
      return [a.category]
    case "group":
      return [m.category(a.category).parent ?? a.category]
    case "merchant":
      return [a.txn.merchantKey || "unknown"]
    case "tag":
      return a.txn.tags.length ? a.txn.tags : ["untagged"]
    case "account":
      return [a.txn.accountId]
    default:
      return ["total"]
  }
}

function labelOf(
  m: Computed,
  by: GroupBy,
  key: string,
  names: Map<string, string>
) {
  if (by === "category" || by === "group") {
    const c = m.category(key)
    return {
      label: c.label,
      color: c.color,
      icon: c.icon,
      parent: by === "category" ? c.parent : null,
    }
  }
  if (by === "tag") {
    const t = m.tags.find((x) => x.id === key)
    return {
      label: t?.name ?? "No tag",
      color: t?.hue ?? null,
      icon: null,
      parent: null,
    }
  }
  if (by === "account")
    return {
      label: m.account.get(key)?.name ?? "Account",
      color: null,
      icon: null,
      parent: null,
    }
  if (by === "merchant")
    return {
      label: names.get(key) ?? "Unknown merchant",
      color: null,
      icon: null,
      parent: null,
    }
  return { label: "Total", color: null, icon: null, parent: null }
}

type Filters = {
  account?: string
  tag?: string
  category?: string
  merchant?: string
}
function filterOf(m: Computed, f: Filters) {
  const codes = f.category
    ? new Set(
        m.categories
          .filter((x) => x.code === f.category || x.parent === f.category)
          .map((x) => x.code)
      )
    : undefined
  return (a: Allocation) =>
    (!f.account || a.txn.accountId === f.account) &&
    (!f.tag || a.txn.tags.includes(f.tag)) &&
    (!codes || codes.has(a.category)) &&
    (!f.merchant || a.txn.merchantKey === f.merchant)
}

/** Totals by key within from..to. */
export function totalsBy(
  m: Computed,
  from: string,
  to: string,
  measure: Measure,
  by: GroupBy,
  keep: (a: Allocation) => boolean = () => true
) {
  const totals = new Map<string, { cents: number; count: number }>()
  const names = new Map<string, string>()
  for (const a of m.allocations) {
    if (a.txn.date < from || a.txn.date > to || !keep(a)) continue
    const v = measureOf(a, measure)
    if (v === undefined) continue
    for (const k of keysOf(m, a, by)) {
      const t = totals.get(k) ?? { cents: 0, count: 0 }
      t.cents += v
      t.count++
      totals.set(k, t)
      if (by === "merchant" && !names.has(k))
        names.set(
          k,
          a.txn.merchantEff ?? a.txn.description ?? "Unknown merchant"
        )
    }
  }
  return { totals, names }
}

/**
 * Income sources flow into one Income node, then out to spending groups and
 * what was saved. When spending beats income the gap comes from savings.
 */
function sankey(m: Computed, from: string, to: string) {
  const { totals: sources, names } = totalsBy(m, from, to, "income", "merchant")
  const { totals: groups } = totalsBy(m, from, to, "spending", "group")
  const pos = (xs: Map<string, { cents: number }>) =>
    [...xs]
      .map(([k, v]) => [k, Math.max(0, v.cents)] as const)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
  const fold = (xs: (readonly [string, number])[], keep: number) =>
    xs.length <= keep + 1
      ? xs
      : [
          ...xs.slice(0, keep),
          ["other", xs.slice(keep).reduce((s, x) => s + x[1], 0)] as const,
        ]
  const ins = fold(pos(sources), 5)
  const outs = fold(pos(groups), 8)
  // A group where more came back than went out (friends paying you back)
  // flows in, so Saved matches income less spending.
  const back = [...groups]
    .filter(([, v]) => v.cents < 0)
    .map(([k, v]) => [k, -v.cents] as const)
  const income =
    ins.reduce((s, x) => s + x[1], 0) + back.reduce((s, x) => s + x[1], 0)
  const spending = outs.reduce((s, x) => s + x[1], 0)
  const nodes: {
    id: string
    label: string
    color: string | null
    column: number
  }[] = []
  const links: { source: string; target: string; value: number }[] = []
  for (const [k, v] of ins) {
    nodes.push({
      id: `in:${k}`,
      label: k === "other" ? "Other income" : (names.get(k) ?? "Income"),
      color: "green",
      column: 0,
    })
    links.push({ source: `in:${k}`, target: "income", value: v })
  }
  for (const [k, v] of back) {
    const c = m.category(k)
    nodes.push({ id: `back:${k}`, label: c.label, color: c.color, column: 0 })
    links.push({ source: `back:${k}`, target: "income", value: v })
  }
  if (spending > income) {
    nodes.push({
      id: "in:savings",
      label: "From savings",
      color: null,
      column: 0,
    })
    links.push({
      source: "in:savings",
      target: "income",
      value: spending - income,
    })
  }
  nodes.push({
    id: "income",
    label: spending > income ? "Income and savings" : "Income",
    color: "green",
    column: 1,
  })
  for (const [k, v] of outs) {
    const c = k === "other" ? null : m.category(k)
    nodes.push({
      id: `out:${k}`,
      label: c?.label ?? "Other spending",
      color: c?.color ?? null,
      column: 2,
    })
    links.push({ source: "income", target: `out:${k}`, value: v })
  }
  if (income > spending) {
    nodes.push({ id: "saved", label: "Saved", color: "positive", column: 2 })
    links.push({ source: "income", target: "saved", value: income - spending })
  }
  return { nodes, links, incomeCents: income, spendingCents: spending }
}

export function registerReports(api: Hono, ctx: Ctx) {
  const { model, recurringOverrides, settings } = ctx
  /**
   * Cash flow for a month, quarter, year or custom range: income and
   * spending by category, group or merchant, a Sankey, and monthly bars.
   */
  api.get("/cashflow", (c) => {
    const m = model.get()
    const q = c.req.query()
    const count = Math.min(36, Math.max(3, Number(q.months) || 12))
    const end = monthOf(m.today)
    const months = monthsBetween(addMonths(end, -(count - 1)), end)
    const flows = monthlyFlows(m, months)
    const p = period(q.period, q.key ?? q.month, m.today, {
      from: q.from,
      to: q.to,
    })
    const by: GroupBy =
      q.by === "group" || q.by === "merchant" ? q.by : "category"
    const rows = (measure: Measure) => {
      const { totals, names } = totalsBy(m, p.from, p.to, measure, by)
      const full = by === "category" ? withChildren(m, totals) : totals
      return [...full]
        .map(([key, t]) => ({
          key,
          ...labelOf(m, by, key, names),
          cents: t.cents,
          count: t.count,
        }))
        .filter((r) => r.cents !== 0)
        .sort((a, b) => b.cents - a.cents)
    }
    const income = rows("income")
    const spending = rows("spending")
    const sum = (xs: { parent: string | null; cents: number }[]) =>
      xs.filter((x) => !x.parent).reduce((s, x) => s + x.cents, 0)
    const incomeCents = sum(income)
    const spendingCents = sum(spending)
    return c.json({
      months: flows,
      period: p,
      by,
      incomeCents,
      spendingCents,
      netCents: incomeCents - spendingCents,
      income,
      spending,
      sankey: sankey(m, p.from, p.to),
    })
  })

  /**
   * The report builder: a measure grouped by a dimension over any range, in
   * time buckets, with optional filters and a comparison period.
   */
  api.get("/reports/build", (c) => {
    const m = model.get()
    const q = c.req.query()
    const measure: Measure =
      q.measure === "income" || q.measure === "net" ? q.measure : "spending"
    const by: GroupBy = (
      ["category", "group", "merchant", "tag", "account", "none"] as const
    ).includes(q.by as GroupBy)
      ? (q.by as GroupBy)
      : "group"
    const interval: Interval = (
      ["week", "month", "quarter", "year", "total"] as const
    ).includes(q.interval as Interval)
      ? (q.interval as Interval)
      : "month"
    const fallback = reportPeriod("6m", m.today, earliestDate(m))
    let from = isDate(q.from) ? q.from : fallback.from
    let to = isDate(q.to) ? q.to : fallback.to
    if (from > to) [from, to] = [to, from]
    const limit = Math.min(20, Math.max(1, Number(q.limit) || 8))
    const keep = filterOf(m, {
      account: q.account,
      tag: q.tag,
      category: q.category,
      merchant: q.merchant,
    })
    const { totals, names } = totalsBy(m, from, to, measure, by, keep)
    const ranked = [...totals].sort(
      (a, b) => Math.abs(b[1].cents) - Math.abs(a[1].cents)
    )
    const shown = ranked
      .slice(0, ranked.length > limit + 1 ? limit : limit + 1)
      .map(([k]) => k)
    const top = new Set(shown)
    const parts = buckets(from, to, interval, settings().weekStartsOn)
    const bucketOf = (date: string) => {
      // Buckets are in order; a binary search finds the one holding date.
      let lo = 0
      let hi = parts.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (date < parts[mid].from) hi = mid - 1
        else if (date > parts[mid].to) lo = mid + 1
        else return mid
      }
      return -1
    }
    const values = new Map<string, number[]>()
    const row = (k: string) => {
      let r = values.get(k)
      if (!r) values.set(k, (r = parts.map(() => 0)))
      return r
    }
    for (const a of m.allocations) {
      if (a.txn.date < from || a.txn.date > to || !keep(a)) continue
      const v = measureOf(a, measure)
      if (v === undefined) continue
      const i = bucketOf(a.txn.date)
      if (i < 0) continue
      for (const k of keysOf(m, a, by)) row(top.has(k) ? k : "other")[i] += v
    }
    const series = [...shown, ...(values.has("other") ? ["other"] : [])].map(
      (key) => ({
        key,
        ...(key === "other"
          ? { label: "Everything else", color: null, icon: null, parent: null }
          : labelOf(m, by, key, names)),
        totalCents: (values.get(key) ?? []).reduce((s, v) => s + v, 0),
        count:
          key === "other"
            ? ranked.slice(shown.length).reduce((s, [, t]) => s + t.count, 0)
            : (totals.get(key)?.count ?? 0),
        values: values.get(key) ?? parts.map(() => 0),
      })
    )
    // A tag can sit on several transactions' tags at once; tag totals may overlap.
    const total =
      measure === "net" || by !== "tag"
        ? [...totals.values()].reduce((s, t) => s + t.cents, 0)
        : null
    const compareKind =
      q.compare === "previous" || q.compare === "year"
        ? q.compare
        : q.compare === "custom" && isDate(q.compareFrom) && isDate(q.compareTo)
          ? "custom"
          : null
    const other =
      compareKind === "custom"
        ? { from: q.compareFrom!, to: q.compareTo! }
        : compareKind
          ? comparison(from, to, compareKind)
          : null
    const before = other
      ? totalsBy(m, other.from, other.to, measure, by, keep).totals
      : null
    return c.json({
      measure,
      by,
      interval,
      from,
      to,
      buckets: parts,
      series,
      totalCents: total,
      compare:
        other && before
          ? {
              from: other.from,
              to: other.to,
              totalCents: [...before.values()].reduce((s, t) => s + t.cents, 0),
              byKey: Object.fromEntries(
                series.map((s) => [
                  s.key,
                  s.key === "other"
                    ? [...before]
                        .filter(([k]) => !top.has(k))
                        .reduce((sum, [, t]) => sum + t.cents, 0)
                    : (before.get(s.key)?.cents ?? 0),
                ])
              ),
            }
          : null,
    })
  })
  api.get("/reports/categories", (c) => {
    const m = model.get()
    const range = asRange(c.req.query("range"), "6m")
    const period = reportPeriod(range, m.today, earliestDate(m))
    const { months, from, to } = period
    const totals = withChildren(m, categoryTotals(m, from, to, "category"))
    const prev = withChildren(
      m,
      categoryTotals(m, period.previous.from, period.previous.to, "category")
    )
    // Per month and category, parents including their children.
    const index = new Map(months.map((mo, i) => [mo, i]))
    const monthly = new Map<string, number[]>()
    const addMonthly = (code: string, i: number, cents: number) => {
      let row = monthly.get(code)
      if (!row) monthly.set(code, (row = months.map(() => 0)))
      row[i] += cents
    }
    for (const a of m.allocations) {
      if (a.txn.pending || a.group !== "expense") continue
      const i = index.get(monthOf(a.txn.date))
      if (i === undefined) continue
      addMonthly(a.category, i, spendCents(a))
      const parent = m.category(a.category).parent
      if (parent) addMonthly(parent, i, spendCents(a))
    }
    const rows = [...totals]
      .filter(([code]) => m.category(code).group === "expense")
      .map(([code, t]) => ({
        code,
        label: m.category(code).label,
        parent: m.category(code).parent,
        cents: t.cents,
        count: t.count,
        previousCents: prev.get(code)?.cents ?? 0,
        monthly: monthly.get(code) ?? months.map(() => 0),
      }))
      .sort((a, b) => b.cents - a.cents)
    const expense = new Map(
      rows.map((r) => [r.code, { cents: r.cents }] as const)
    )
    return c.json({
      range,
      from,
      to,
      months,
      rows,
      totalCents: topLevelSum(m, expense),
    })
  })
  api.get("/reports/categories/:code", (c) => {
    const m = model.get()
    const cat = m.categories.find((x) => x.code === c.req.param("code"))
    if (!cat) throw notFound("Category")
    const count = 12
    const end = monthOf(m.today)
    const months = monthsBetween(addMonths(end, -(count - 1)), end)
    const codes = new Set(
      m.categories
        .filter((x) => x.code === cat.code || x.parent === cat.code)
        .map((x) => x.code)
    )
    const monthly = months.map((month) => ({ month, cents: 0 }))
    const index = new Map(months.map((mo, i) => [mo, i]))
    const merchants = new Map<
      string,
      { name: string; cents: number; count: number }
    >()
    const sign = cat.group === "income" ? 1 : -1
    for (const a of m.allocations) {
      if (!codes.has(a.category) || a.txn.pending) continue
      const i = index.get(monthOf(a.txn.date))
      if (i === undefined) continue
      monthly[i].cents += sign * a.amountCents
      const key = a.txn.merchantKey || "unknown"
      const row = merchants.get(key) ?? {
        name: a.txn.merchantEff ?? "Unknown merchant",
        cents: 0,
        count: 0,
      }
      row.cents += sign * a.amountCents
      row.count++
      merchants.set(key, row)
    }
    const full = monthly.slice(0, -1)
    return c.json({
      category: {
        code: cat.code,
        label: cat.label,
        group: cat.group,
        parent: cat.parent,
        custom: cat.custom,
      },
      monthly,
      averageCents: full.length
        ? Math.round(full.reduce((s, x) => s + x.cents, 0) / full.length)
        : 0,
      totalCents: monthly.reduce((s, x) => s + x.cents, 0),
      merchants: [...merchants]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.cents - a.cents)
        .slice(0, 25),
      children: m.categories
        .filter((x) => x.parent === cat.code)
        .map((x) => {
          let cents = 0
          for (const a of m.allocations)
            if (
              a.category === x.code &&
              !a.txn.pending &&
              index.has(monthOf(a.txn.date))
            )
              cents += sign * a.amountCents
          return { code: x.code, label: x.label, cents }
        }),
    })
  })
  api.get("/reports/merchants", (c) => {
    const m = model.get()
    const range = asRange(c.req.query("range"), "6m")
    const { from, to } = reportPeriod(range, m.today, earliestDate(m))
    const rows = new Map<
      string,
      {
        key: string
        name: string
        cents: number
        count: number
        last: string
        category: string
      }
    >()
    for (const t of m.txns) {
      if (
        t.hidden ||
        t.pending ||
        t.amountCents >= 0 ||
        t.date < from ||
        t.date > to ||
        !t.merchantKey
      )
        continue
      if (m.category(t.categoryEff).group !== "expense") continue
      const r = rows.get(t.merchantKey) ?? {
        key: t.merchantKey,
        name: t.merchantEff ?? t.merchantKey,
        cents: 0,
        count: 0,
        last: t.date,
        category: t.categoryEff,
      }
      r.cents -= t.amountCents
      r.count++
      rows.set(t.merchantKey, r)
    }
    const list = [...rows.values()].sort((a, b) => b.cents - a.cents)
    return c.json({
      range,
      from,
      to,
      rows: list.map((r) => ({
        ...r,
        categoryLabel: m.category(r.category).label,
        averageCents: Math.round(r.cents / r.count),
      })),
    })
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
    const spend = txns
      .filter((t) => !t.pending)
      .reduce((s, t) => s - t.amountCents, 0)
    const recurring = detectRecurring(m, recurringOverrides()).find(
      (r) => r.key === key
    )
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
      recurring: recurring
        ? {
            cadence: recurring.cadence,
            amountCents: recurring.amountCents,
            nextDate: recurring.nextDate,
            status: recurring.status,
          }
        : null,
      transactions: txns.slice(0, 50).map((t) => txnJson(m, t)),
    })
  })
}
