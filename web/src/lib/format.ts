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
const MONTH_SHORT_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  year: "2-digit",
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
export const epoch = (date: string) => parseDay(date).getTime() / 1000
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
export const monthShortYear = (month: string) =>
  MONTH_SHORT_YEAR.format(parseDay(`${month}-01`))
export const monthEpoch = (month: string) => epoch(`${month}-01`)
export const epochMonth = (seconds: number) =>
  MONTH.format(new Date(seconds * 1000))
export const epochMonthYear = (seconds: number) =>
  MONTH_SHORT_YEAR.format(new Date(seconds * 1000))
export const epochDate = (seconds: number) =>
  DATE.format(new Date(seconds * 1000))
export const epochFullDate = (seconds: number) =>
  DATE_YEAR.format(new Date(seconds * 1000))

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
