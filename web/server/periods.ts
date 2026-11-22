import {
  addDays,
  addMonths,
  fromDate,
  isDate,
  isMonth,
  monthEnd,
  monthOf,
  toDate,
} from "./analytics.ts"

export type PeriodKind = "month" | "quarter" | "year" | "custom"
export type Period = {
  kind: PeriodKind
  /** YYYY-MM, YYYY-Qn, YYYY, or from..to for a custom range. */
  key: string
  from: string
  to: string
  previous: string | null
  next: string | null
}

const quarterOf = (month: string) =>
  `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`
const quarterStart = (key: string) =>
  `${key.slice(0, 4)}-${String((Number(key.slice(6)) - 1) * 3 + 1).padStart(2, "0")}`

/**
 * A cash-flow period: one month, quarter or year, or a custom date range.
 * Unknown keys fall back to the period containing today. `next` is null
 * once it would start after today.
 */
export function period(
  kind: string | undefined,
  key: string | undefined,
  today: string,
  range?: { from?: string; to?: string }
): Period {
  const month = monthOf(today)
  if (kind === "custom" && isDate(range?.from) && isDate(range?.to)) {
    const [from, to] =
      range.from <= range.to ? [range.from, range.to] : [range.to, range.from]
    return {
      kind: "custom",
      key: `${from}..${to}`,
      from,
      to,
      previous: null,
      next: null,
    }
  }
  if (kind === "quarter") {
    const k = key && /^\d{4}-Q[1-4]$/.test(key) ? key : quarterOf(month)
    const start = quarterStart(k)
    const nextStart = addMonths(start, 3)
    return {
      kind: "quarter",
      key: k,
      from: `${start}-01`,
      to: monthEnd(addMonths(start, 2)),
      previous: quarterOf(addMonths(start, -3)),
      next: nextStart > month ? null : quarterOf(nextStart),
    }
  }
  if (kind === "year") {
    const k = key && /^\d{4}$/.test(key) ? key : today.slice(0, 4)
    return {
      kind: "year",
      key: k,
      from: `${k}-01-01`,
      to: `${k}-12-31`,
      previous: String(Number(k) - 1),
      next:
        Number(k) + 1 > Number(today.slice(0, 4))
          ? null
          : String(Number(k) + 1),
    }
  }
  const k = isMonth(key) ? key : month
  return {
    kind: "month",
    key: k,
    from: `${k}-01`,
    to: monthEnd(k),
    previous: addMonths(k, -1),
    next: addMonths(k, 1) > month ? null : addMonths(k, 1),
  }
}

export type Interval = "week" | "month" | "quarter" | "year" | "total"
export type Bucket = { key: string; from: string; to: string }

/** Time buckets covering from..to; weeks start on the chosen day. */
export function buckets(
  from: string,
  to: string,
  interval: Interval,
  weekStartsOn: "sunday" | "monday" = "monday"
): Bucket[] {
  if (interval === "total") return [{ key: "total", from, to }]
  const out: Bucket[] = []
  if (interval === "week") {
    const dow = new Date(fromDate(from)).getUTCDay()
    const offset = (dow - (weekStartsOn === "monday" ? 1 : 0) + 7) % 7
    for (
      let d = addDays(from, -offset);
      d <= to && out.length < 520;
      d = addDays(d, 7)
    )
      out.push({
        key: d,
        from: d < from ? from : d,
        to: addDays(d, 6) > to ? to : addDays(d, 6),
      })
    return out
  }
  const step = interval === "month" ? 1 : interval === "quarter" ? 3 : 12
  let start = monthOf(from)
  if (interval === "quarter") start = quarterStart(quarterOf(start))
  if (interval === "year") start = `${from.slice(0, 4)}-01`
  for (
    let mo = start;
    `${mo}-01` <= to && out.length < 600;
    mo = addMonths(mo, step)
  ) {
    const end = monthEnd(addMonths(mo, step - 1))
    out.push({
      key:
        interval === "month"
          ? mo
          : interval === "quarter"
            ? quarterOf(mo)
            : mo.slice(0, 4),
      from: `${mo}-01` < from ? from : `${mo}-01`,
      to: end > to ? to : end,
    })
  }
  return out
}

/** The same length of time just before, or the same dates a year earlier. */
export function comparison(
  from: string,
  to: string,
  kind: "previous" | "year"
): { from: string; to: string } {
  if (kind === "year") {
    // 29 February has no match in a common year; use the 28th.
    const back = (d: string) =>
      `${Number(d.slice(0, 4)) - 1}${d.slice(4) === "-02-29" ? "-02-28" : d.slice(4)}`
    return { from: back(from), to: back(to) }
  }
  // Whole months compare with the same number of whole months.
  if (from.endsWith("-01") && to === monthEnd(monthOf(to))) {
    const n =
      (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      Number(to.slice(5, 7)) -
      Number(from.slice(5, 7)) +
      1
    const start = addMonths(monthOf(from), -n)
    return { from: `${start}-01`, to: monthEnd(addMonths(start, n - 1)) }
  }
  const days = Math.round((fromDate(to) - fromDate(from)) / 86_400_000) + 1
  return {
    from: toDate(fromDate(from) - days * 86_400_000),
    to: addDays(from, -1),
  }
}
