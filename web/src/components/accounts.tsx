import { useLayoutEffect, useState } from "react"
import { cn } from "@zsrobinson/shell"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@zsrobinson/shell/ui/chart"
import { chartTooltipTime } from "@zsrobinson/shell/lib/chart-time"
import {
  fitTimeTicks,
  formatTimeTick,
  labelWidth,
  niceTicks,
  timeTicks,
} from "@zsrobinson/shell/lib/chart-ticks"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import { Change } from "@/components/money"
import { epoch, epochFullDate, money, moneyTick } from "@/lib/format"
import type {
  Account,
  ManualType,
  NetWorthByType,
  NetWorthGroup,
} from "@/lib/types"

/** The account groups on the Accounts page, in order. */
export const ACCOUNT_GROUPS = [
  { key: "cash", label: "Cash" },
  { key: "credit", label: "Credit cards" },
  { key: "investments", label: "Investments" },
  { key: "loans", label: "Loans" },
  { key: "property", label: "Property and vehicles" },
  { key: "other", label: "Other" },
] as const satisfies { key: NetWorthGroup; label: string }[]

/** Which group an account sits in; matches the server's net worth bands. */
export function accountGroup(a: Pick<Account, "type" | "subtype">) {
  const key: NetWorthGroup =
    a.type === "depository"
      ? "cash"
      : a.type === "investment" || a.type === "brokerage"
        ? "investments"
        : a.type === "credit"
          ? "credit"
          : a.type === "loan"
            ? "loans"
            : a.subtype === "property" || a.subtype === "vehicle"
              ? "property"
              : "other"
  return ACCOUNT_GROUPS.find((g) => g.key === key)!
}

export const MANUAL_TYPES: { value: ManualType; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "credit", label: "Credit card" },
  { value: "loan", label: "Loan" },
  { value: "investment", label: "Investment" },
  { value: "property", label: "Property" },
  { value: "vehicle", label: "Vehicle" },
  { value: "other", label: "Other" },
]
/** "1,250.50" or "-40" in dollars to cents; null when it is not a number. */
export function parseCents(text: string) {
  const clean = text.replace(/[,$\s]/g, "").replace("−", "-")
  if (!clean || Number.isNaN(Number(clean))) return null
  return Math.round(Number(clean) * 100)
}

export const isDebt = (t: ManualType | null | undefined) =>
  t === "credit" || t === "loan"

/**
 * Each band keeps one hue on every page. Assets stack up from zero, debts
 * stack down from it; red and green stay free for gains and losses.
 */
const BANDS: Record<NetWorthGroup, { label: string; color: string }> = {
  cash: { label: "Cash", color: "var(--cat-blue)" },
  investments: { label: "Investments", color: "var(--cat-purple)" },
  property: { label: "Property and vehicles", color: "var(--cat-cyan)" },
  other: { label: "Other", color: "var(--cat-none)" },
  credit: { label: "Credit cards", color: "var(--cat-orange)" },
  loans: { label: "Loans", color: "var(--cat-magenta)" },
}
const DEBTS: NetWorthGroup[] = ["credit", "loans"]
const NET_COLOR = "var(--foreground)"

const MARGIN = { left: 0, right: 12, top: 12, bottom: 0 }
const Y_AXIS_WIDTH = 72

function useWidth() {
  const [element, ref] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(600)
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => setWidth(element.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [ref, width] as const
}

/** Net worth as stacked bands by account type, with the net as a line. */
export function NetWorthStack({
  data,
  className,
}: {
  data: NetWorthByType
  className?: string
}) {
  const [ref, width] = useWidth()
  const groups = data.groups
  const points = data.series.map((p) => {
    const row: Record<string, number> = {
      time: epoch(p.date),
      net: p.net / 100,
    }
    for (const g of groups) row[g] = (p[g] ?? 0) / 100
    return row
  })
  if (!points.length)
    return (
      <div
        role="status"
        className={cn(
          "flex items-center justify-center text-sm text-muted-foreground",
          className
        )}
      >
        No history in this range
      </div>
    )
  const config: ChartConfig = {
    ...Object.fromEntries(
      groups.map((g) => [g, { label: BANDS[g].label, color: BANDS[g].color }])
    ),
    net: { label: "Net worth", color: NET_COLOR },
  }
  // Value axis: from the deepest debt to the tallest stack of assets.
  let lo = 0
  let hi = 0
  for (const p of points) {
    let up = 0
    let down = 0
    for (const g of groups) {
      if (p[g] >= 0) up += p[g]
      else down += p[g]
    }
    hi = Math.max(hi, up, p.net)
    lo = Math.min(lo, down, p.net)
  }
  let y = niceTicks(lo, hi, 6)
  // Debts much smaller than a step get a thin strip below zero, not a
  // whole empty step of axis.
  const top = niceTicks(0, hi, 6)
  const step = top.ticks[1] - top.ticks[0]
  if (lo < 0 && -lo < step * 0.3)
    y = {
      domain: [lo - top.domain[1] * 0.02, top.domain[1]],
      ticks: top.ticks,
    }
  const first = points[0].time
  const last = points.at(-1)!.time
  const plotWidth = Math.max(80, width - Y_AXIS_WIDTH - MARGIN.right)
  const t = timeTicks(
    first,
    last,
    Math.max(2, Math.floor(plotWidth / (labelWidth("Nov ’26") + 24))),
    { utc: true }
  )
  const xLabel = (time: number) =>
    formatTimeTick(time, t.unit, { utc: true, crossesYear: t.crossesYear })
  const xTicks = fitTimeTicks(
    t.ticks,
    [first, last],
    plotWidth,
    xLabel,
    MARGIN.right
  )
  const whole = (v: number) => money(Math.round(v * 100), { whole: true })
  return (
    <div ref={ref} className={cn("w-full min-w-0", className)}>
      <ChartContainer
        config={config}
        role="img"
        aria-label="Net worth by account type over time"
        className="aspect-auto h-full w-full tabular-nums"
      >
        <ComposedChart accessibilityLayer data={points} margin={MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            scale="linear"
            domain={[first, last]}
            allowDataOverflow
            ticks={xTicks}
            interval={0}
            tickLine={false}
            axisLine={false}
            height={30}
            tickFormatter={xLabel}
          />
          <YAxis
            width={Y_AXIS_WIDTH}
            domain={y.domain}
            ticks={y.ticks}
            interval={0}
            allowDataOverflow
            tickLine={false}
            axisLine={false}
            tickFormatter={moneyTick}
            tick={{ fontSize: 11, width: 70 }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const time = chartTooltipTime(payload)
                  return time === undefined ? "—" : epochFullDate(time)
                }}
                formatter={(value, name) => (
                  <span
                    className={cn(
                      "flex w-full justify-between gap-4",
                      name === "net" && "font-medium"
                    )}
                  >
                    <span>{config[String(name)]?.label ?? name}</span>
                    <span className="font-medium tabular-nums">
                      {whole(Number(value))}
                    </span>
                  </span>
                )}
              />
            }
          />
          <ChartLegend
            itemSorter={null}
            content={
              <ChartLegendContent className="flex-wrap gap-x-4 gap-y-1.5 [&>div]:whitespace-nowrap" />
            }
          />
          <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
          {groups.map((g) => (
            <Area
              key={g}
              dataKey={g}
              type="linear"
              stackId={DEBTS.includes(g) ? "debts" : "assets"}
              stroke={`var(--color-${g})`}
              fill={`var(--color-${g})`}
              fillOpacity={0.35}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          ))}
          <Line
            dataKey="net"
            type="linear"
            stroke={`var(--color-net)`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}

/** Each band's balance now and its change over the range. */
export function NetWorthChanges({ data }: { data: NetWorthByType }) {
  const last = data.series.at(-1)
  if (!last) return null
  return (
    <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
      {data.groups.map((g) => (
        <li
          key={g}
          className="flex min-h-8 items-center gap-2 text-sm tabular-nums"
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: BANDS[g].color }}
          />
          <span className="min-w-0 flex-1">{BANDS[g].label}</span>
          <span className="font-medium">{money(last[g], { whole: true })}</span>
          <span className="w-24 text-right text-xs">
            <Change cents={data.change[g] ?? 0} />
          </span>
        </li>
      ))}
    </ul>
  )
}
