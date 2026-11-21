const currency = new Map<string, Intl.NumberFormat>()
function formatter(code: string, compact: boolean, cents: boolean) {
  const key = `${code}:${compact}:${cents}`
  let f = currency.get(key)
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code === "UNKNOWN" ? "USD" : code,
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: compact ? 0 : cents ? 2 : 0,
      maximumFractionDigits: compact ? 1 : cents ? 2 : 0,
    })
    currency.set(key, f)
  }
  return f
}

/** Money in cents. `sign` adds an explicit + for inflows. */
export function money(
  cents: number | null | undefined,
  { currency: code = "USD", sign = false, compact = false, whole = false } = {}
) {
  if (cents == null) return "—"
  const text = formatter(code, compact, !whole).format(Math.abs(cents) / 100)
  if (cents < 0) return `−${text}`
  return sign && cents > 0 ? `+${text}` : text
}
export const compactMoney = (cents: number) =>
  money(cents, { compact: Math.abs(cents) >= 1_000_000, whole: true })
/** Chart axis values arrive in dollars. */
export const axisMoney = (dollars: number) =>
  compactMoney(Math.round(dollars * 100))

const DATE = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})
const DATE_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})
const MONTH = new Intl.DateTimeFormat(undefined, {
  month: "short",
  timeZone: "UTC",
})
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})
const WEEKDAY = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

export const parseDay = (date: string) => new Date(`${date}T00:00:00Z`)
/** Chart time in epoch milliseconds, the shell's convention. */
export const epoch = (date: string) => parseDay(date).getTime()
export function shortDate(date: string, today?: string) {
  const d = parseDay(date)
  return today && date.slice(0, 4) !== today.slice(0, 4)
    ? DATE_YEAR.format(d)
    : DATE.format(d)
}
export const longDate = (date: string) => WEEKDAY.format(parseDay(date))
export const fullDate = (date: string) => DATE_YEAR.format(parseDay(date))
export const monthName = (month: string) =>
  MONTH_YEAR.format(parseDay(`${month}-01`))
export const monthShort = (month: string) =>
  MONTH.format(parseDay(`${month}-01`))
const shortYear = (d: Date) =>
  `${MONTH.format(d)} ’${String(d.getUTCFullYear()).slice(2)}`
/** "Jan ’26". */
export const monthShortYear = (month: string) =>
  shortYear(parseDay(`${month}-01`))
export const monthEpoch = (month: string) => epoch(`${month}-01`)
export const epochMonth = (ms: number) => MONTH.format(new Date(ms))
export const epochMonthYear = (ms: number) => shortYear(new Date(ms))
export const epochDate = (ms: number) => DATE.format(new Date(ms))
export const epochFullDate = (ms: number) => DATE_YEAR.format(new Date(ms))
export const epochMonthName = (ms: number) => MONTH_YEAR.format(new Date(ms))

// Enough digits for a round step: $125k, $12.5k, $1.25k.
const trimNumber = (n: number) =>
  String(
    n >= 100
      ? Math.round(n)
      : n >= 10
        ? Math.round(n * 10) / 10
        : Math.round(n * 100) / 100
  )
/** Round axis money from chart dollars: $105k, $1.5k, $450. */
export function moneyTick(dollars: number) {
  const abs = Math.abs(dollars)
  const sign = dollars < 0 ? "−" : ""
  if (abs >= 1_000_000) return `${sign}$${trimNumber(abs / 1_000_000)}M`
  if (abs >= 1000) return `${sign}$${trimNumber(abs / 1000)}k`
  return `${sign}$${Math.round(abs)}`
}

export function addMonths(month: string, n: number) {
  const d = parseDay(`${month}-01`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 7)
}
export function daysBetween(from: string, to: string) {
  return Math.round(
    (parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000
  )
}
export function relativeDay(date: string, today: string) {
  const days = daysBetween(today, date)
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  if (days === -1) return "Yesterday"
  if (days > 1 && days < 7) return `In ${days} days`
  return shortDate(date, today)
}
export const percent = (value: number, digits = 0) =>
  `${(value * 100).toFixed(digits).replace(/^-/, "−")}%`
/** A change as "+12%", "−5%" or "0%": the sign follows the rounded figure. */
export function percentChange(value: number, digits = 0) {
  const text = Math.abs(value * 100).toFixed(digits)
  if (Number(text) === 0) return `${(0).toFixed(digits)}%`
  return `${value > 0 ? "+" : "−"}${text}%`
}
/** An account number's last digits, as banks print them: "••4821". */
export const mask = (digits: string) => `••${digits}`
/** One wording for a connection's state, on badges and account rows alike. */
export const syncLabel = (status: string) =>
  ({
    healthy: "Up to date",
    stale: "Sync behind",
    error: "Sync failing",
    disabled: "Sync paused",
  })[status] ?? "Sync failing"
/** "credit card" → "Credit card". */
export const sentenceCase = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
/** "Today", "Yesterday", then the full date, for day headers everywhere. */
export function dayHeading(date: string, today?: string) {
  if (today) {
    const days = daysBetween(today, date)
    if (days === 0) return "Today"
    if (days === -1) return "Yesterday"
  }
  return longDate(date)
}

export const CADENCE: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
}
export const RANGE_OPTIONS = [
  { value: "1m", label: "1 month", duration: 30 * 86400 },
  { value: "3m", label: "3 months", duration: 91 * 86400 },
  { value: "6m", label: "6 months", duration: 182 * 86400 },
  { value: "ytd", label: "Year to date", duration: 365 * 86400 },
  { value: "1y", label: "1 year", duration: 365 * 86400 },
  { value: "all", label: "All time", duration: "all" as const },
] as const

export function accountKind(a: { type: string; subtype: string | null }) {
  if (a.type === "depository") return "Cash"
  if (a.type === "credit") return "Credit cards"
  if (a.type === "investment") return "Investments"
  if (a.type === "loan") return "Loans"
  return "Other"
}
export const titleCase = (s: string) =>
  s.replace(/(^|\s)\S/g, (c) => c.toUpperCase())
export { pluralize } from "@zsrobinson/shell/lib/format"

const ASSET: Record<string, string> = {
  etf: "ETF",
  "mutual fund": "Mutual fund",
  "fixed income": "Bonds",
  equity: "Stocks",
  cash: "Cash",
  cryptocurrency: "Crypto",
  derivative: "Options",
}
export const assetType = (type: string) =>
  ASSET[type.toLowerCase()] ?? titleCase(type)

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  semimonthly: 15,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
}
export const cadenceDays = (cadence: string) => CADENCE_DAYS[cadence] ?? 30
