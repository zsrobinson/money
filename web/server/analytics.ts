import { normalizeText } from "./normalize.ts"
import type { AccountView, Allocation, Computed, EffTxn } from "./model.ts"

const DAY = 86_400_000
export const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const fromDate = (date: string) => Date.parse(`${date}T00:00:00Z`)
export const addDays = (date: string, days: number) =>
  toDate(fromDate(date) + days * DAY)
export const monthOf = (date: string) => date.slice(0, 7)
export function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}
export function monthsBetween(from: string, to: string) {
  const out: string[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m)
  return out
}
export const monthEnd = (month: string) =>
  addDays(`${addMonths(month, 1)}-01`, -1)
export const isMonth = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
export const isDate = (s: unknown): s is string =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(fromDate(s))

export const RANGES = ["1m", "3m", "6m", "ytd", "1y", "all"] as const
export type Range = (typeof RANGES)[number]
export const asRange = (s: unknown, fallback: Range = "6m"): Range =>
  RANGES.includes(s as Range) ? (s as Range) : fallback

export function rangeStart(range: Range, today: string, earliest: string) {
  const start =
    range === "1m"
      ? addDays(today, -30)
      : range === "3m"
        ? addDays(today, -91)
        : range === "6m"
          ? addDays(today, -182)
          : range === "ytd"
            ? `${today.slice(0, 4)}-01-01`
            : range === "1y"
              ? addDays(today, -365)
              : earliest
  return start < earliest ? earliest : start
}

/** Last known balance on or before each date (forward fill), sampled. */
function balanceAt(history: { date: string; cents: number }[]) {
  let i = 0
  let last: number | null = null
  return (date: string) => {
    while (i < history.length && history[i].date <= date)
      last = history[i++].cents
    return last
  }
}

export function sampleDates(from: string, to: string, maxPoints = 120) {
  const days = Math.max(1, Math.round((fromDate(to) - fromDate(from)) / DAY))
  const step = Math.max(1, Math.ceil(days / maxPoints))
  const out: string[] = []
  for (let d = from; d < to; d = addDays(d, step)) out.push(d)
  out.push(to)
  return out
}

export function earliestDate(c: Computed) {
  let earliest = c.today
  for (const list of c.detail.balanceHistory.values())
    if (list.length && list[0].date < earliest) earliest = list[0].date
  const last = c.txns.at(-1)
  if (last && last.date < earliest) earliest = last.date
  return earliest
}

/** Signed balance series per account, liabilities negative. */
export function accountSeries(
  c: Computed,
  account: AccountView,
  dates: string[]
) {
  const history = c.detail.balanceHistory.get(account.id) ?? []
  const at = balanceAt(history)
  const sign = account.liability ? -1 : 1
  // A closed account stops at its last reported balance instead of carrying
  // a stale balance into today's totals.
  const closedAfter =
    account.availability === "available" ? undefined : history.at(-1)?.date
  return dates.map((d) => {
    const v = at(d)
    if (closedAfter !== undefined && d > closedAfter) return null
    return v == null ? null : sign * v
  })
}

export function netWorthSeries(c: Computed, dates: string[]) {
  const included = c.accounts.filter((a) => !a.excludeNetWorth)
  const assets = dates.map(() => 0)
  const liabilities = dates.map(() => 0)
  for (const a of included) {
    const s = accountSeries(c, a, dates)
    s.forEach((v, i) => {
      if (v == null) return
      if (v >= 0) assets[i] += v
      else liabilities[i] += v
    })
  }
  return dates.map((date, i) => ({
    date,
    assets: assets[i],
    liabilities: liabilities[i],
    net: assets[i] + liabilities[i],
  }))
}

export const spendCents = (a: Allocation) => -a.amountCents
export function inRange(t: EffTxn, from: string, to: string) {
  return t.date >= from && t.date <= to
}

export type MonthFlow = {
  month: string
  incomeCents: number
  spendingCents: number
  netCents: number
  byCategory: Record<string, number>
}

/** Income and spending per month; transfers are excluded, refunds reduce spending. */
export function monthlyFlows(
  c: Computed,
  months: string[],
  filter?: (a: Allocation) => boolean
) {
  const index = new Map(months.map((m, i) => [m, i]))
  const flows: MonthFlow[] = months.map((month) => ({
    month,
    incomeCents: 0,
    spendingCents: 0,
    netCents: 0,
    byCategory: {},
  }))
  for (const a of c.allocations) {
    if (a.txn.pending) continue
    const i = index.get(monthOf(a.txn.date))
    if (i === undefined || a.group === "transfer" || (filter && !filter(a)))
      continue
    const f = flows[i]
    if (a.group === "income") f.incomeCents += a.amountCents
    else {
      f.spendingCents += spendCents(a)
      f.byCategory[a.owned] = (f.byCategory[a.owned] ?? 0) + spendCents(a)
    }
  }
  for (const f of flows) f.netCents = f.incomeCents - f.spendingCents
  return flows
}

export function categoryTotals(
  c: Computed,
  from: string,
  to: string,
  by: "owned" | "category" = "owned"
) {
  const totals = new Map<string, { cents: number; count: number }>()
  for (const a of c.allocations) {
    if (a.txn.pending || a.group === "transfer" || !inRange(a.txn, from, to))
      continue
    const key = by === "owned" ? a.owned : a.category
    const t = totals.get(key) ?? { cents: 0, count: 0 }
    t.cents += a.group === "income" ? a.amountCents : spendCents(a)
    t.count++
    totals.set(key, t)
  }
  return totals
}

const CADENCES = [
  { id: "weekly", days: 7, min: 5, max: 9 },
  { id: "biweekly", days: 14, min: 12, max: 17 },
  { id: "semimonthly", days: 15, min: 13, max: 17 },
  { id: "monthly", days: 30, min: 26, max: 35 },
  { id: "quarterly", days: 91, min: 80, max: 100 },
  { id: "yearly", days: 365, min: 340, max: 390 },
] as const
const HINT: Record<string, string> = {
  WEEKLY: "weekly",
  BIWEEKLY: "biweekly",
  SEMI_MONTHLY: "semimonthly",
  MONTHLY: "monthly",
  ANNUALLY: "yearly",
  QUARTERLY: "quarterly",
}
export const cadenceDays = (id: string | null | undefined) =>
  CADENCES.find((c) => c.id === id)?.days ?? 30
const median = (xs: number[]) => {
  const s = xs.toSorted((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export type RecurringItem = {
  key: string
  merchant: string
  kind: "expense" | "income"
  cadence: string
  cadenceSource: "detected" | "provider" | "manual"
  amountCents: number
  lastDate: string
  nextDate: string
  count: number
  status: "active" | "inactive" | "ignored" | "cancelled"
  accountId: string
  category: string
  history: { date: string; amountCents: number; id: string }[]
}

export function detectRecurring(
  c: Computed,
  overrides: Map<
    string,
    { status: string; cadence: string | null; expected_cents: number | null }
  >
) {
  const groups = new Map<string, EffTxn[]>()
  for (const t of c.txns) {
    if (t.hidden || t.pending || !t.merchantKey) continue
    const group = c.category(t.categoryEff).group
    if (group === "transfer") continue
    let g = groups.get(t.merchantKey)
    if (!g) groups.set(t.merchantKey, (g = []))
    g.push(t)
  }
  const hints = new Map(
    c.detail.recurringHints
      .filter((h) => h.frequency)
      .map((h) => [normalizeText(h.merchant), h])
  )
  const items: RecurringItem[] = []
  for (const [key, list] of groups) {
    const override = overrides.get(key)
    const sorted = list.toSorted((a, b) => (a.date < b.date ? -1 : 1))
    if (sorted.length < 3 && !override) continue
    const gaps = sorted
      .slice(1)
      .map((t, i) => (fromDate(t.date) - fromDate(sorted[i].date)) / DAY)
    const gap = gaps.length ? median(gaps) : 30
    const recent = sorted.slice(-4).map((t) => t.amountCents)
    const typical = median(recent)
    const spread =
      Math.max(...recent.map((v) => Math.abs(v - typical))) /
      Math.max(1, Math.abs(typical))
    const hint = hints.get(key)
    const hinted = hint?.frequency
      ? HINT[hint.frequency.toUpperCase()]
      : undefined
    const detected = CADENCES.find((x) => gap >= x.min && gap <= x.max)?.id
    const regular =
      gaps.length >= 2 &&
      gaps.filter((g) => Math.abs(g - gap) <= Math.max(4, gap * 0.2)).length >=
        gaps.length * 0.7
    if (!override && !hinted && (!detected || !regular || spread > 0.6))
      continue
    const cadence = override?.cadence ?? hinted ?? detected ?? "monthly"
    const last = sorted.at(-1)!
    const nextDate = addDays(last.date, cadenceDays(cadence))
    const lapsed =
      fromDate(c.today) - fromDate(last.date) > cadenceDays(cadence) * 2 * DAY
    const status = (
      override?.status === "ignored" || override?.status === "cancelled"
        ? override.status
        : lapsed || (hint && !hint.active)
          ? "inactive"
          : "active"
    ) as RecurringItem["status"]
    items.push({
      key,
      merchant: last.merchantEff ?? last.description ?? key,
      kind: typical > 0 ? "income" : "expense",
      cadence,
      cadenceSource: override?.cadence
        ? "manual"
        : hinted
          ? "provider"
          : "detected",
      amountCents: override?.expected_cents ?? Math.round(typical),
      lastDate: last.date,
      nextDate,
      count: sorted.length,
      status,
      accountId: last.accountId,
      category: last.categoryEff,
      history: sorted
        .slice(-12)
        .map((t) => ({ date: t.date, amountCents: t.amountCents, id: t.id })),
    })
  }
  return items.sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1))
}
